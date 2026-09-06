import { strict as assert } from 'node:assert';

// Runs only disposable containers; never reads the deployment .env or database.
const image = process.env.API_TEST_IMAGE || 'sigmagit-api-production-test';
const prefix = `sigmagit-smoke-${crypto.randomUUID().slice(0, 8)}`;
const names = {
  network: prefix,
  db: `${prefix}-db`,
  redis: `${prefix}-redis`,
  api: `${prefix}-api`,
  volume: `${prefix}-storage`,
};
async function docker(...args: string[]) {
  const child = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(`docker ${args[0]} failed: ${err}`);
  return out.trim();
}
async function eventually(check: () => Promise<void>, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last: unknown;
  do {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
    }
    await Bun.sleep(500);
  } while (Date.now() < deadline);
  throw last;
}
const databaseUrl = `postgresql://postgres:docker-test-only@${names.db}:5432/api_test`;
const installationSecret = crypto.randomUUID() + crypto.randomUUID();
const environment: Record<string, string> = {
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'production',
  STORAGE_TYPE: 'local',
  API_URL: 'https://api.example.test',
  WEB_URL: 'https://example.test',
  INSTALLATION_SECRET: installationSecret,
  REDIS_SESSION_URL: `redis://${names.redis}:6379`,
  ENABLE_MIGRATIONS: 'false',
  ...Object.fromEntries(
    [
      'BETTER_AUTH_SECRET',
      'INTERNAL_API_SECRET',
      'REGISTRY_JWT_SECRET',
      'WS_TICKET_SECRET',
      'RUNNER_REGISTRATION_SECRET',
    ].map((name) => [name, crypto.randomUUID() + crypto.randomUUID()]),
  ),
};
const envArgs = Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
let base = '';
const request = (path: string, init?: RequestInit) =>
  fetch(base + path, { ...init, signal: AbortSignal.timeout(6000) });
try {
  await docker('network', 'create', names.network);
  await docker('volume', 'create', names.volume);
  await docker(
    'run',
    '-d',
    '--name',
    names.db,
    '--network',
    names.network,
    '-e',
    'POSTGRES_PASSWORD=docker-test-only',
    '-e',
    'POSTGRES_DB=api_test',
    'postgres:16-alpine',
  );
  await docker('run', '-d', '--name', names.redis, '--network', names.network, 'redis:7-alpine');
  await eventually(async () => {
    await docker('exec', names.db, 'pg_isready', '-U', 'postgres');
  });
  const migrate = () =>
    docker(
      'run',
      '--rm',
      '--network',
      names.network,
      '-e',
      `DATABASE_URL=${databaseUrl}`,
      image,
      'bun',
      'run',
      'dist/migrate.js',
    );
  await migrate();
  await Promise.all([migrate(), migrate()]);
  console.log('PASS fresh and concurrent repeat migrations');
  const startApi = async () => {
    await docker(
      'run',
      '-d',
      '--name',
      names.api,
      '--network',
      names.network,
      '-p',
      '127.0.0.1::3001',
      '-v',
      `${names.volume}:/data/repos`,
      ...envArgs,
      image,
    );
    base = `http://${await docker('port', names.api, '3001/tcp')}`;
    await eventually(async () => {
      assert.equal((await request('/ready')).status, 200);
    });
  };
  await startApi();
  const credentials = {
    name: 'Docker Admin',
    username: 'dockeradmin',
    email: 'admin@example.test',
    password: `Aa1!${crypto.randomUUID()}`,
  };
  const install = (authorized: boolean) =>
    request('/api/install', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorized ? { authorization: `Bearer ${installationSecret}` } : {}),
      },
      body: JSON.stringify(credentials),
    });
  assert.equal((await install(false)).status, 401);
  assert.deepEqual(
    (await Promise.all([install(true), install(true)])).map((r) => r.status).sort(),
    [200, 409],
  );
  const login = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: environment.WEB_URL },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  assert.equal(login.status, 200, await login.text());
  assert.match(login.headers.get('set-cookie') || '', /Secure/i);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  console.log('PASS protected atomic bootstrap and production login');
  await docker('exec', names.api, 'sh', '-c', 'printf persistent > /data/repos/docker-probe');
  await docker('stop', '--time', '30', names.api);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', names.api), '0');
  await docker('rm', names.api);
  await startApi();
  assert.equal(await docker('exec', names.api, 'cat', '/data/repos/docker-probe'), 'persistent');
  console.log('PASS graceful stop and persistent storage after replacement');
  for (const dependency of [names.db, names.redis]) {
    await docker('stop', dependency);
    await eventually(async () => {
      assert.equal((await request('/health')).status, 200);
      assert.equal((await request('/ready')).status, 503);
    });
    await docker('start', dependency);
    await eventually(async () => {
      assert.equal((await request('/ready')).status, 200);
    });
    const session = await request('/api/auth/get-session', { headers: { cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.email, credentials.email);
  }
  console.log('PASS database and Redis outage/recovery with independent liveness');
} catch (error) {
  try {
    console.error(await docker('logs', '--tail', '15', names.api));
  } catch {
    /* absent */
  }
  throw error;
} finally {
  for (const name of [names.api, names.redis, names.db]) {
    try {
      await docker('rm', '-f', name);
    } catch {
      /* creation may have failed */
    }
  }
  try {
    await docker('volume', 'rm', names.volume);
  } catch {
    /* absent */
  }
  try {
    await docker('network', 'rm', names.network);
  } catch {
    /* absent */
  }
}
