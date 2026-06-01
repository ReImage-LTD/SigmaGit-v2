import { normalizeUrl } from '@sigmagit/lib';

const baseOrigins = ['http://localhost:3000', 'http://localhost:3001'];

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function isProductionEnv(): boolean {
  return (
    process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME === 'production'
  );
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL!,
  redisSessionUrl: process.env.REDIS_SESSION_URL || process.env.REDIS_URL,
  redisCacheUrl: process.env.REDIS_CACHE_URL || process.env.REDIS_URL,
  webhooksEnabled: process.env.ENABLE_WEBHOOKS !== 'false',
  discordWebhookSecret: process.env.DISCORD_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || null,
  enableMigrations: process.env.ENABLE_MIGRATIONS !== 'false',
  migrationCredentialsKey: process.env.MIGRATION_CREDENTIALS_KEY || null,
  runnerRegistrationSecret: process.env.RUNNER_REGISTRATION_SECRET || null,
  trustProxy: process.env.TRUST_PROXY === 'true',
  isProduction: isProductionEnv(),
  storage: {
    type: (process.env.STORAGE_TYPE as 's3' | 'local') || 's3',
    localPath: process.env.STORAGE_LOCAL_PATH || './data/repos',
    s3: {
      endpoint: process.env.S3_ENDPOINT || 'https://storage.railway.app',
      region: process.env.S3_REGION || 'auto',
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      bucket: process.env.S3_BUCKET || process.env.S3_BUCKET_NAME!,
    },
  },
  optimizations: {
    gitNegativeCacheEnabled: envBool('GIT_NEGATIVE_CACHE_ENABLED', true),
    gitNegativeCacheTtlMs: envInt('GIT_NEGATIVE_CACHE_TTL_MS', 5000),
    s3AdaptiveCopyEnabled: envBool('S3_ADAPTIVE_COPY_ENABLED', true),
    s3AdaptiveDeleteEnabled: envBool('S3_ADAPTIVE_DELETE_ENABLED', true),
    s3AdaptiveMinConcurrency: envInt('S3_ADAPTIVE_MIN_CONCURRENCY', 4),
    s3AdaptiveMaxConcurrency: envInt('S3_ADAPTIVE_MAX_CONCURRENCY', 32),
  },
  betterAuthSecret: process.env.BETTER_AUTH_SECRET!,
  nodeEnv: process.env.NODE_ENV || process.env.RAILWAY_ENVIRONMENT_NAME || 'development',
  apiUrl: process.env.API_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3001',
  webUrl: process.env.WEB_URL || 'localhost:3000',
  rateLimit: {
    general: envInt('RATE_LIMIT_GENERAL', 500),
    auth: envInt('RATE_LIMIT_AUTH', 5),
    write: envInt('RATE_LIMIT_WRITE', 30),
    search: envInt('RATE_LIMIT_SEARCH', 60),
    unauth: envInt('RATE_LIMIT_UNAUTH', 120),
    apiKey: envInt('RATE_LIMIT_API_KEY', 200),
    publicWrite: envInt('RATE_LIMIT_PUBLIC_WRITE', 10),
  },
  maxConcurrentRest: envInt('MAX_CONCURRENT_REQUESTS', 50),
  maxConcurrentGit: envInt('MAX_CONCURRENT_GIT', 15),
  email: {
    provider: (process.env.EMAIL_PROVIDER as 'resend' | 'smtp') || 'resend',
    resendApiKey: process.env.RESEND_API_KEY,
    smtp: {
      host: process.env.SMTP_HOST!,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
    fromAddress: process.env.EMAIL_FROM || 'SigmaGit <noreply@sigmagit.dev>',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
  emailDomainRestriction: {
    enabled: process.env.DISABLE_EMAIL_DOMAIN_RESTRICTION !== 'true',
  },
};

export const getApiUrl = (): string => {
  if (config.apiUrl) {
    return normalizeUrl(config.apiUrl);
  }

  if (config.isProduction) {
    throw new Error('API_URL must be set in production');
  }

  return `http://localhost:${config.port}`;
};

export const getWebUrl = (): string => {
  if (config.webUrl) {
    return normalizeUrl(config.webUrl);
  }

  if (config.isProduction) {
    throw new Error('WEB_URL must be set in production');
  }

  return 'http://localhost:3000';
};

export const getTrustedOrigins = (): string[] => {
  const origins: string[] = [...baseOrigins];

  if (config.apiUrl) {
    origins.push(normalizeUrl(config.apiUrl));
  }

  if (config.webUrl) {
    origins.push(normalizeUrl(config.webUrl));
  }

  return origins;
};

export const getAllowedOrigins = (): string[] => {
  const allowedOrigins = [...baseOrigins];

  if (config.apiUrl) {
    allowedOrigins.push(normalizeUrl(config.apiUrl));
  }

  if (config.webUrl) {
    allowedOrigins.push(normalizeUrl(config.webUrl));
  }

  return allowedOrigins;
};
