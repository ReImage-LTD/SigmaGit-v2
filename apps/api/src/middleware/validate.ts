import { createMiddleware } from 'hono/factory';
import type { Context, Env, MiddlewareHandler, ValidationTargets } from 'hono';
import { z } from 'zod';

export type ValidationErrorBody = {
  error: 'Validation failed';
  details: Array<{ path: string; message: string }>;
};

export function formatZodError(error: z.ZodError): ValidationErrorBody {
  return {
    error: 'Validation failed',
    details: error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
  };
}

type Target = 'json' | 'query' | 'param';

/**
 * Strict Zod validator middleware for Hono.
 * Rejects unexpected keys when using z.object().strict() schemas.
 */
export function zValidator<
  T extends z.ZodType,
  TargetKey extends Target,
  E extends Env = Env,
>(
  target: TargetKey,
  schema: T
): MiddlewareHandler<
  E & {
    Variables: {
      validated: {
        [K in TargetKey]?: z.infer<T>;
      } & Record<string, unknown>;
    };
  }
> {
  return createMiddleware(async (c, next) => {
    let data: unknown;

    try {
      if (target === 'json') {
        try {
          data = await c.req.json();
        } catch {
          return c.json(
            {
              error: 'Validation failed',
              details: [{ path: '(root)', message: 'Invalid JSON body' }],
            } satisfies ValidationErrorBody,
            400
          );
        }
      } else if (target === 'query') {
        data = c.req.query();
      } else {
        data = c.req.param();
      }
    } catch (err) {
      return c.json(
        {
          error: 'Validation failed',
          details: [{ path: '(root)', message: 'Failed to read request input' }],
        } satisfies ValidationErrorBody,
        400
      );
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      return c.json(formatZodError(parsed.error), 400);
    }

    const existing = (c.get('validated') as Record<string, unknown> | undefined) ?? {};
    c.set('validated', { ...existing, [target]: parsed.data });
    await next();
  });
}

/** Read validated data previously set by zValidator. */
export function getValidated<T>(c: Context, target: Target): T {
  const bag = c.get('validated') as Record<string, unknown> | undefined;
  return bag?.[target] as T;
}

// ─── Shared schemas ─────────────────────────────────────────────────────────

export const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  })
  .strict();

export const uuidParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const ownerNameParamSchema = z
  .object({
    owner: z
      .string()
      .min(1)
      .max(39)
      .regex(/^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/),
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/),
  })
  .strict();

export const installBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    username: z
      .string()
      .trim()
      .min(3)
      .max(39)
      .regex(/^[a-zA-Z0-9_-]+$/),
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
  })
  .strict();

export const updateEmailBodySchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const updatePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
  })
  .strict();

export const deleteAccountBodySchema = z
  .object({
    password: z.string().min(1).max(128),
  })
  .strict();

export const webhookCreateBodySchema = z
  .object({
    url: z.string().url().max(2048),
    secret: z.string().max(256).optional(),
    events: z
      .array(z.enum(['push', 'pull_request', 'issues', 'tag', 'branch']))
      .min(1)
      .max(20),
    active: z.boolean().optional(),
    contentType: z.enum(['json', 'form']).optional(),
  })
  .strict();

export const webhookPatchBodySchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    secret: z.string().max(256).nullable().optional(),
    events: z
      .array(z.enum(['push', 'pull_request', 'issues', 'tag', 'branch']))
      .min(1)
      .max(20)
      .optional(),
    active: z.boolean().optional(),
    contentType: z.enum(['json', 'form']).optional(),
  })
  .strict();

export const migrationCreateBodySchema = z
  .object({
    source: z.string().min(1).max(50),
    sourceUrl: z.string().max(2048).optional(),
    sourceBaseUrl: z.string().max(2048).optional(),
    sourceOwner: z.string().max(200).optional(),
    sourceRepo: z.string().max(200).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    credentials: z
      .object({
        authToken: z.string().max(8192).optional(),
        authType: z.string().max(50).optional(),
        sshKey: z.string().max(65536).optional(),
        sshKeyPassphrase: z.string().max(1024).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const runnerRegisterBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    labels: z.array(z.string().max(64)).max(32).optional(),
    registrationToken: z.string().min(1).max(512).optional(),
    secret: z.string().min(1).max(512).optional(),
  })
  .strict();

export const adminRoleBodySchema = z
  .object({
    role: z.enum(['user', 'admin', 'moderator']),
  })
  .strict();

export const createRepositoryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).optional(),
    visibility: z.enum(['public', 'private']),
    organizationId: z.string().max(64).optional(),
    license: z.string().max(64).optional(),
  })
  .strict();
