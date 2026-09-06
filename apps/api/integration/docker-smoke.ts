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
  REDIS_CACHE_URL: `redis://${names.redis}:6379`,
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
  const database = (query: string) =>
    docker(
      'exec',
      names.db,
      'psql',
      '-U',
      'postgres',
      '-d',
      'api_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      query,
    );
  // Exercise an upgrade with existing stars, not just an empty-schema migration.
  await docker(
    'run',
    '--rm',
    '--network',
    names.network,
    '-e',
    `DATABASE_URL=${databaseUrl}`,
    image,
    'bun',
    '-e',
    `
    import { cpSync, writeFileSync } from 'node:fs';
    import postgres from 'postgres';
    import { drizzle } from 'drizzle-orm/postgres-js';
    import { migrate } from 'drizzle-orm/postgres-js/migrator';
    cpSync('/app/packages/db/migrations', '/tmp/migrations', { recursive: true });
    const journal = await Bun.file('/tmp/migrations/meta/_journal.json').json();
    journal.entries = journal.entries.slice(0, journal.entries.findIndex(entry => entry.tag === '0010_api_performance'));
    writeFileSync('/tmp/migrations/meta/_journal.json', JSON.stringify(journal));
    const client = postgres(process.env.DATABASE_URL, { max: 1 });
    try { await migrate(drizzle(client), { migrationsFolder: '/tmp/migrations' }); }
    finally { await client.end(); }
  `,
  );
  const existingRepo = crypto.randomUUID();
  await database(`INSERT INTO users (id,name,username,email) VALUES ('upgrade-owner','Upgrade','upgradeowner','upgrade@example.test');
    INSERT INTO repositories (id,name,owner_id) VALUES ('${existingRepo}','upgrade','upgrade-owner');
    INSERT INTO stars (user_id,repository_id) VALUES ('upgrade-owner','${existingRepo}');`);
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
  assert.equal(
    await database(`SELECT star_count FROM repositories WHERE id='${existingRepo}'`),
    '1',
  );
  await database("DELETE FROM users WHERE id='upgrade-owner'");
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
  const topRepo = crypto.randomUUID();
  const otherRepo = crypto.randomUUID();
  await database(`
    INSERT INTO users (id,name,username,email) VALUES ('star-a','Star A','stara','stara@example.test'), ('star-b','Star B','starb','starb@example.test');
    INSERT INTO repositories (id,name,owner_id) SELECT '${topRepo}','popular',id FROM users WHERE username='dockeradmin';
    INSERT INTO repositories (id,name,owner_id) SELECT '${otherRepo}','other',id FROM users WHERE username='dockeradmin';
    INSERT INTO stars (user_id,repository_id) VALUES ('star-a','${topRepo}'), ('star-b','${topRepo}'), ('star-a','${otherRepo}');
  `);
  const ranking = await (await request('/api/repositories/public?sortBy=stars')).json();
  assert.equal(ranking.repos[0].id, topRepo);
  assert.equal(ranking.repos[0].starCount, 2);
  await database(`BEGIN; DELETE FROM stars WHERE user_id='star-a'; ROLLBACK;
    UPDATE stars SET repository_id='${otherRepo}' WHERE user_id='star-b';
    DELETE FROM users WHERE id='star-a';`);
  assert.equal(
    await database(
      `SELECT count(*) FROM repositories r WHERE star_count <> (SELECT count(*) FROM stars s WHERE s.repository_id=r.id)`,
    ),
    '0',
  );
  const owner = await database("SELECT id FROM users WHERE username='dockeradmin'");
  const storageOwner = await database(
    `SELECT storage_owner_id FROM repositories WHERE id='${topRepo}'`,
  );
  await docker(
    'exec',
    names.api,
    'bun',
    '-e',
    `
    import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
    const work = '/tmp/cache-git-test';
    mkdirSync(work);
    const run = args => { const result = Bun.spawnSync(['git', ...args]); if (result.exitCode) throw new Error(result.stderr.toString()); };
    run(['init', '-b', 'main', work]);
    writeFileSync(work + '/note.txt', 'before');
    run(['-C', work, 'add', '.']);
    run(['-C', work, '-c', 'user.name=Docker', '-c', 'user.email=docker@example.test', 'commit', '-m', 'seed']);
    cpSync(work + '/.git', '/data/repos/repos/${storageOwner}/popular', { recursive: true });
  `,
  );
  const fileUrl = '/api/repositories/dockeradmin/popular/file';
  assert.equal(
    (await (await request(fileUrl + '?path=note.txt&branch=main')).json()).content,
    'before',
  );
  const edit = await request(fileUrl, {
    method: 'POST',
    headers: { cookie, origin: environment.WEB_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ branch: 'main', path: 'note.txt', content: 'after', message: 'edit' }),
  });
  assert.equal(edit.status, 200, await edit.text());
  assert.equal(
    (await (await request(fileUrl + '?path=note.txt&branch=main')).json()).content,
    'after',
  );
  assert.ok(
    !(await docker('exec', names.redis, 'redis-cli', 'INFO', 'commandstats')).includes(
      'cmdstat_scan:',
    ),
    'Git reads and invalidation must not scan Redis',
  );
  console.log(
    'PASS Redis-backed Git reads invalidate immediately after browser edits without SCAN',
  );
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort().reverse();
  await database(`INSERT INTO notifications (id,user_id,type,title,created_at) VALUES
    ('${ids[0]}','${owner}','mention','one','2026-09-06 12:00:00.123456'),
    ('${ids[1]}','${owner}','mention','two','2026-09-06 12:00:00.123456'),
    ('${ids[2]}','${owner}','mention','three','2026-09-06 12:00:00.123455');`);
  let cursor: string | null = null;
  const seen: string[] = [];
  for (let page = 0; page < 3; page++) {
    const response = await request(
      '/api/notifications?limit=1' + (cursor ? '&cursor=' + cursor : ''),
      { headers: { cookie } },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    seen.push(data.notifications[0].id);
    cursor = data.nextCursor;
  }
  assert.deepEqual(seen, ids);
  assert.equal(cursor, null);
  assert.equal(
    (await request('/api/notifications?cursor=invalid', { headers: { cookie } })).status,
    400,
  );
  console.log(
    'PASS indexed star rankings, transactional/cascading counts and precise notification cursors',
  );
  await database(`INSERT INTO repositories (name,owner_id) SELECT 'plan-' || n,'${owner}' FROM generate_series(1,5000) n;
    INSERT INTO notifications (user_id,type,title,created_at,read) SELECT '${owner}','mention','plan-' || n,'2000-01-01'::timestamp,n % 100 <> 0 FROM generate_series(1,10000) n;
    ANALYZE repositories; ANALYZE notifications;`);
  const plans = [
    [
      "SELECT id FROM repositories WHERE visibility='public' ORDER BY star_count DESC NULLS LAST,id DESC NULLS LAST LIMIT 20",
      'repositories_visibility_stars_idx',
    ],
    [
      `SELECT id FROM notifications WHERE user_id='${owner}' ORDER BY created_at DESC NULLS LAST,id DESC NULLS LAST LIMIT 20`,
      'notifications_user_created_idx',
    ],
    [
      `SELECT id FROM notifications WHERE user_id='${owner}' AND read=false AND (created_at,id) < ('2026-09-06 12:00:00.123456'::timestamp,'${ids[0]}'::uuid) ORDER BY created_at DESC NULLS LAST,id DESC NULLS LAST LIMIT 20`,
      'notifications_user_read_created_idx',
    ],
  ];
  for (const [query, index] of plans) {
    const plan = await database('EXPLAIN (FORMAT JSON) ' + query);
    assert.ok(plan.includes(index), plan);
    assert.ok(!plan.includes('"Node Type": "Sort"'), plan);
  }
  console.log('PASS ranking and notification query plans use ordered indexes without sorting');
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
