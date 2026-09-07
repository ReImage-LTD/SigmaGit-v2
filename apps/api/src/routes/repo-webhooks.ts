import { Hono } from "hono";
import { db, repositoryWebhooks, backgroundTasks } from "@sigmagit/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { createHmac } from "crypto";
import { config } from "../config";
import { canManageRepository } from "../lib/access";
import { resolveRepositoryWithAccess } from "../lib/repo-helpers";
import { guardedFetch, validateOutboundUrl } from "../security/ssrf";
import {
  getValidated,
  ownerNameParamSchema,
  webhookCreateBodySchema,
  webhookPatchBodySchema,
  zValidator,
} from "../middleware/validate";

export type WebhookEvent = "push" | "pull_request" | "issues" | "tag" | "branch";

const app = new Hono<{ Variables: AuthVariables }>();

// ─── Utility: deliver a webhook payload to all matching hooks ────────────────

export async function deliverWebhookEvent(
  repositoryId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  if (!config.webhooksEnabled) return;
  const hooks = await db.query.repositoryWebhooks.findMany({ where: and(eq(repositoryWebhooks.repositoryId, repositoryId), eq(repositoryWebhooks.active, true)) });
  const tasks = hooks.filter(hook => (hook.events as WebhookEvent[]).includes(event)).map(hook => ({ kind: 'webhook' as const, payload: { webhookId: hook.id, event, body: payload } }));
  if (tasks.length) await db.insert(backgroundTasks).values(tasks);

}

// ─── GET /api/repositories/:owner/:name/webhooks ─────────────────────────────

app.get("/api/repositories/:owner/:name/webhooks", requireAuth, async (c) => {
  const owner = c.req.param("owner");
  const name = c.req.param("name");
  const currentUser = c.get("user")!;

  const repo = await resolveRepositoryWithAccess(owner, name, currentUser);
  if (!repo) return c.json({ error: "Repository not found" }, 404);
  if (!(await canManageRepository(repo, currentUser))) {
    return c.json({ error: "Not authorized" }, 403);
  }

  const hooks = await db.query.repositoryWebhooks.findMany({
    where: eq(repositoryWebhooks.repositoryId, repo.id),
  });

  // Mask secrets
  const sanitized = hooks.map((h) => ({ ...h, secret: h.secret ? "***" : null }));
  return c.json({ webhooks: sanitized });
});

// ─── POST /api/repositories/:owner/:name/webhooks ────────────────────────────

app.post(
  "/api/repositories/:owner/:name/webhooks",
  requireAuth,
  zValidator("param", ownerNameParamSchema),
  zValidator("json", webhookCreateBodySchema),
  async (c) => {
  const { owner, name } = getValidated<{ owner: string; name: string }>(c, "param");
  const currentUser = c.get("user")!;
  const body = getValidated<{
    url: string;
    secret?: string;
    events: WebhookEvent[];
    active?: boolean;
    contentType?: "json" | "form";
  }>(c, "json");

  const urlCheck = validateOutboundUrl(body.url, { requireHttps: config.isProduction });
  if (!urlCheck.ok) {
    return c.json({ error: urlCheck.error || "Invalid URL" }, 400);
  }

  const repo = await resolveRepositoryWithAccess(owner, name, currentUser);
  if (!repo) return c.json({ error: "Repository not found" }, 404);
  if (!(await canManageRepository(repo, currentUser))) {
    return c.json({ error: "Not authorized" }, 403);
  }

  const [hook] = await db
    .insert(repositoryWebhooks)
    .values({
      repositoryId: repo.id,
      url: body.url,
      secret: body.secret ?? null,
      events: body.events,
      active: body.active ?? true,
      contentType: body.contentType ?? "json",
      createdById: currentUser.id,
    })
    .returning();

  return c.json({ webhook: { ...hook, secret: hook.secret ? "***" : null } }, 201);
});

// ─── PATCH /api/repositories/:owner/:name/webhooks/:hookId ───────────────────

app.patch(
  "/api/repositories/:owner/:name/webhooks/:hookId",
  requireAuth,
  zValidator("param", ownerNameParamSchema),
  zValidator("json", webhookPatchBodySchema),
  async (c) => {
  const { owner, name } = getValidated<{ owner: string; name: string }>(c, "param");
  const hookId = c.req.param("hookId");
  const currentUser = c.get("user")!;
  const body = getValidated<{
    url?: string;
    secret?: string | null;
    events?: WebhookEvent[];
    active?: boolean;
    contentType?: "json" | "form";
  }>(c, "json");

  const repo = await resolveRepositoryWithAccess(owner, name, currentUser);
  if (!repo) return c.json({ error: "Repository not found" }, 404);
  if (!(await canManageRepository(repo, currentUser))) {
    return c.json({ error: "Not authorized" }, 403);
  }

  const existing = await db.query.repositoryWebhooks.findFirst({
    where: and(eq(repositoryWebhooks.id, hookId), eq(repositoryWebhooks.repositoryId, repo.id)),
  });
  if (!existing) return c.json({ error: "Webhook not found" }, 404);

  const updates: Partial<typeof repositoryWebhooks.$inferInsert> = { updatedAt: new Date() };
  if (body.url !== undefined) {
    const urlCheck = validateOutboundUrl(body.url, { requireHttps: config.isProduction });
    if (!urlCheck.ok) {
      return c.json({ error: urlCheck.error || "Invalid URL" }, 400);
    }
    updates.url = body.url;
  }
  if ("secret" in body) updates.secret = body.secret ?? null;
  if (body.events !== undefined) updates.events = body.events;
  if (body.active !== undefined) updates.active = body.active;
  if (body.contentType !== undefined) updates.contentType = body.contentType;

  await db.update(repositoryWebhooks).set(updates).where(eq(repositoryWebhooks.id, hookId));

  return c.json({ success: true });
});

// ─── DELETE /api/repositories/:owner/:name/webhooks/:hookId ──────────────────

app.delete(
  "/api/repositories/:owner/:name/webhooks/:hookId",
  requireAuth,
  zValidator("param", ownerNameParamSchema),
  async (c) => {
  const { owner, name } = getValidated<{ owner: string; name: string }>(c, "param");
  const hookId = c.req.param("hookId");
  const currentUser = c.get("user")!;

  const repo = await resolveRepositoryWithAccess(owner, name, currentUser);
  if (!repo) return c.json({ error: "Repository not found" }, 404);
  if (!(await canManageRepository(repo, currentUser))) {
    return c.json({ error: "Not authorized" }, 403);
  }

  await db
    .delete(repositoryWebhooks)
    .where(and(eq(repositoryWebhooks.id, hookId), eq(repositoryWebhooks.repositoryId, repo.id)));

  return c.json({ success: true });
});

export default app;
