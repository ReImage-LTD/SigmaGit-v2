import { isStrongSecret, MIN_SECRET_LENGTH } from './security/secrets';
import { normalizeUrl } from '@sigmagit/lib';
import { z } from 'zod';

const devOrigins = ['http://localhost:3000', 'http://localhost:3001'];

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

export function isProductionEnv(): boolean {
  return (
    process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME === 'production'
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(normalizeUrl(value)).protocol === 'https:';
  } catch {
    return false;
  }
}

function isHttpOrHttpsUrl(value: string): boolean {
  try {
    const p = new URL(normalizeUrl(value)).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

const ProductionConfigSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    BETTER_AUTH_SECRET: z
      .string()
      .refine(
        (v) => isStrongSecret(v),
        `BETTER_AUTH_SECRET must be ≥${MIN_SECRET_LENGTH} chars and non-placeholder`,
      ),
    INTERNAL_API_SECRET: z
      .string()
      .refine(
        (v) => isStrongSecret(v),
        `INTERNAL_API_SECRET must be ≥${MIN_SECRET_LENGTH} chars and non-placeholder`,
      ),
    REGISTRY_JWT_SECRET: z
      .string()
      .refine(
        (v) => isStrongSecret(v),
        `REGISTRY_JWT_SECRET must be ≥${MIN_SECRET_LENGTH} chars and non-placeholder`,
      ),
    WS_TICKET_SECRET: z
      .string()
      .refine(
        (v) => isStrongSecret(v),
        `WS_TICKET_SECRET must be ≥${MIN_SECRET_LENGTH} chars and non-placeholder`,
      ),
    API_URL: z.string().min(1).refine(isHttpsUrl, 'API_URL must be HTTPS in production'),
    WEB_URL: z.string().min(1).refine(isHttpsUrl, 'WEB_URL must be HTTPS in production'),
    STORAGE_TYPE: z.enum(['s3', 'local']).default('s3'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),
    STORAGE_LOCAL_PATH: z.string().optional(),
    MIGRATION_CREDENTIALS_KEY: z.string().optional(),
    RUNNER_REGISTRATION_SECRET: z.string().optional(),
    ENABLE_MIGRATIONS: z.string().optional(),
    TRUST_PROXY: z.string().optional(),
    COOKIE_DOMAIN: z.string().optional(),
    ALLOWED_ORIGINS: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.STORAGE_TYPE === 's3') {
      if (!data.S3_ACCESS_KEY_ID) {
        ctx.addIssue({
          code: 'custom',
          message: 'S3_ACCESS_KEY_ID required when STORAGE_TYPE=s3',
          path: ['S3_ACCESS_KEY_ID'],
        });
      }
      if (!data.S3_SECRET_ACCESS_KEY) {
        ctx.addIssue({
          code: 'custom',
          message: 'S3_SECRET_ACCESS_KEY required when STORAGE_TYPE=s3',
          path: ['S3_SECRET_ACCESS_KEY'],
        });
      }
      if (!data.S3_BUCKET && !data.S3_BUCKET_NAME) {
        ctx.addIssue({
          code: 'custom',
          message: 'S3_BUCKET required when STORAGE_TYPE=s3',
          path: ['S3_BUCKET'],
        });
      }
    }
    const migrationsOn = data.ENABLE_MIGRATIONS === 'true';
    if (migrationsOn && !isStrongSecret(data.MIGRATION_CREDENTIALS_KEY ?? '', 16)) {
      ctx.addIssue({
        code: 'custom',
        message: 'MIGRATION_CREDENTIALS_KEY (≥16 chars) required when migrations are enabled',
        path: ['MIGRATION_CREDENTIALS_KEY'],
      });
    }
    // Runner registration secret should be set in production (runners may be used).
    if (!isStrongSecret(data.RUNNER_REGISTRATION_SECRET ?? '', 16)) {
      ctx.addIssue({
        code: 'custom',
        message: 'RUNNER_REGISTRATION_SECRET (≥16 chars) required in production',
        path: ['RUNNER_REGISTRATION_SECRET'],
      });
    }
    // Distinct secrets — reusing BETTER_AUTH_SECRET is forbidden.
    const secrets = [
      data.BETTER_AUTH_SECRET,
      data.INTERNAL_API_SECRET,
      data.REGISTRY_JWT_SECRET,
      data.WS_TICKET_SECRET,
    ];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({
        code: 'custom',
        message:
          'BETTER_AUTH_SECRET, INTERNAL_API_SECRET, REGISTRY_JWT_SECRET, and WS_TICKET_SECRET must all be distinct',
        path: ['INTERNAL_API_SECRET'],
      });
    }
    if (data.ALLOWED_ORIGINS) {
      for (const part of data.ALLOWED_ORIGINS.split(',')) {
        const o = part.trim();
        if (!o) continue;
        if (!isHttpsUrl(o)) {
          ctx.addIssue({
            code: 'custom',
            message: `ALLOWED_ORIGINS entry must be HTTPS in production: ${o}`,
            path: ['ALLOWED_ORIGINS'],
          });
        }
      }
    }
  });

export type AppConfig = {
  port: number;
  databaseUrl: string;
  redisSessionUrl: string | undefined;
  redisCacheUrl: string | undefined;
  webhooksEnabled: boolean;
  discordWebhookSecret: string | null;
  enableMigrations: boolean;
  migrationCredentialsKey: string | null;
  runnerRegistrationSecret: string | null;
  trustProxy: boolean;
  /** Comma-separated CIDRs of trusted reverse proxies (for client IP). */
  trustedProxyCidrs: string[];
  isProduction: boolean;
  storage: {
    type: 's3' | 'local';
    localPath: string;
    s3: {
      endpoint: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
    };
  };
  optimizations: {
    gitNegativeCacheEnabled: boolean;
    gitNegativeCacheTtlMs: number;
    s3AdaptiveCopyEnabled: boolean;
    s3AdaptiveDeleteEnabled: boolean;
    s3AdaptiveMinConcurrency: number;
    s3AdaptiveMaxConcurrency: number;
  };
  betterAuthSecret: string;
  internalApiSecret: string;
  registryJwtSecret: string;
  wsTicketSecret: string;
  cookieDomain: string | undefined;
  nodeEnv: string;
  apiUrl: string;
  webUrl: string;
  rateLimit: {
    general: number;
    auth: number;
    write: number;
    search: number;
    unauth: number;
    apiKey: number;
    publicWrite: number;
  };
  maxConcurrentRest: number;
  maxConcurrentGit: number;
  email: {
    provider: 'resend' | 'smtp';
    resendApiKey: string | undefined;
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
    };
    fromAddress: string;
  };
  github: {
    clientId: string | undefined;
    clientSecret: string | undefined;
  };
  emailDomainRestriction: {
    enabled: boolean;
  };
};

function loadConfig(): AppConfig {
  const isProduction = isProductionEnv();

  if (isProduction) {
    const result = ProductionConfigSchema.safeParse(process.env);
    if (!result.success) {
      const messages = result.error.issues.map(
        (i) => `${i.path.join('.') || 'config'}: ${i.message}`,
      );
      console.error(
        '[Config] Production configuration invalid:\n' + messages.map((m) => `  - ${m}`).join('\n'),
      );
      throw new Error(`Invalid production configuration:\n${messages.join('\n')}`);
    }
  } else {
    // Development: warn on missing secrets but allow weak defaults for local work.
    if (!process.env.BETTER_AUTH_SECRET) {
      console.warn('[Config] BETTER_AUTH_SECRET not set — using insecure dev default');
      process.env.BETTER_AUTH_SECRET = 'dev-only-better-auth-secret-do-not-use-in-prod!!';
    }
    if (!process.env.INTERNAL_API_SECRET) {
      process.env.INTERNAL_API_SECRET = 'dev-only-internal-api-secret-do-not-use!!';
    }
    if (!process.env.REGISTRY_JWT_SECRET) {
      process.env.REGISTRY_JWT_SECRET = 'dev-only-registry-jwt-secret-do-not-use!!';
    }
    if (!process.env.WS_TICKET_SECRET) {
      process.env.WS_TICKET_SECRET = 'dev-only-ws-ticket-secret-do-not-use-in-prod!!';
    }
    if (!process.env.DATABASE_URL) {
      console.warn('[Config] DATABASE_URL not set');
    }
  }

  // Cookie domain: host-only by default (undefined). Explicit COOKIE_DOMAIN only.
  const cookieDomainRaw = process.env.COOKIE_DOMAIN?.trim();
  const cookieDomain =
    cookieDomainRaw && cookieDomainRaw.length > 0
      ? cookieDomainRaw.startsWith('.')
        ? cookieDomainRaw
        : cookieDomainRaw
      : undefined;

  return {
    port: parseInt(process.env.PORT || '3001', 10),
    databaseUrl: process.env.DATABASE_URL || '',
    redisSessionUrl: process.env.REDIS_SESSION_URL || process.env.REDIS_URL,
    redisCacheUrl: process.env.REDIS_CACHE_URL || process.env.REDIS_URL,
    webhooksEnabled: process.env.ENABLE_WEBHOOKS !== 'false',
    discordWebhookSecret: process.env.DISCORD_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || null,
    // Migrations are opt-in (worker must be intentional).
    enableMigrations: process.env.ENABLE_MIGRATIONS === 'true',
    migrationCredentialsKey: process.env.MIGRATION_CREDENTIALS_KEY || null,
    runnerRegistrationSecret: process.env.RUNNER_REGISTRATION_SECRET || null,
    trustProxy: process.env.TRUST_PROXY === 'true',
    trustedProxyCidrs: (process.env.TRUSTED_PROXY_CIDRS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    isProduction,
    storage: {
      type: (process.env.STORAGE_TYPE as 's3' | 'local') || 's3',
      localPath: process.env.STORAGE_LOCAL_PATH || './data/repos',
      s3: {
        endpoint: process.env.S3_ENDPOINT || 'https://storage.railway.app',
        region: process.env.S3_REGION || 'auto',
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        bucket: process.env.S3_BUCKET || process.env.S3_BUCKET_NAME || '',
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
    internalApiSecret: process.env.INTERNAL_API_SECRET!,
    registryJwtSecret: process.env.REGISTRY_JWT_SECRET!,
    wsTicketSecret: process.env.WS_TICKET_SECRET!,
    cookieDomain,
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
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
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
}

export const config: AppConfig = loadConfig();

export const getApiUrl = (): string => {
  if (config.apiUrl) {
    const url = normalizeUrl(config.apiUrl);
    if (config.isProduction && !isHttpsUrl(url)) {
      throw new Error('API_URL must be HTTPS in production');
    }
    return url;
  }

  if (config.isProduction) {
    throw new Error('API_URL must be set in production');
  }

  return `http://localhost:${config.port}`;
};

export const getWebUrl = (): string => {
  if (config.webUrl) {
    const url = normalizeUrl(config.webUrl);
    if (config.isProduction && !isHttpsUrl(url)) {
      throw new Error('WEB_URL must be HTTPS in production');
    }
    return url;
  }

  if (config.isProduction) {
    throw new Error('WEB_URL must be set in production');
  }

  return 'http://localhost:3000';
};

function collectConfiguredOrigins(): string[] {
  const origins: string[] = [];

  if (!config.isProduction) {
    origins.push(...devOrigins);
  }

  if (config.apiUrl) {
    try {
      origins.push(normalizeUrl(config.apiUrl));
    } catch {
      /* ignore invalid */
    }
  }

  if (config.webUrl) {
    try {
      origins.push(normalizeUrl(config.webUrl));
    } catch {
      /* ignore */
    }
  }

  const extra = process.env.ALLOWED_ORIGINS;
  if (extra) {
    for (const part of extra.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        const n = normalizeUrl(trimmed);
        if (isHttpOrHttpsUrl(n)) origins.push(n);
      } catch {
        /* skip */
      }
    }
  }

  return [...new Set(origins)];
}

export const getTrustedOrigins = (): string[] => collectConfiguredOrigins();

export const getAllowedOrigins = (): string[] => collectConfiguredOrigins();

/** Exported for unit tests — production schema validation only. */
export function validateProductionEnv(env: Record<string, string | undefined>) {
  return ProductionConfigSchema.safeParse(env);
}
