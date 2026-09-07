import { Hono } from "hono";
import { db, repositoryMigrations, migrationCredentials } from "@sigmagit/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { parseLimit, parseOffset } from "../lib/validation";
import { encryptCredential } from "../lib/credential-cipher";
import { config } from "../config";
import { guardedFetch, outboundUrlError, validateOutboundUrl } from "../security/ssrf";
import {
  getValidated,
  migrationCreateBodySchema,
  zValidator,
} from "../middleware/validate";

const app = new Hono<{ Variables: AuthVariables }>();

function requireHttpsOutbound(): boolean {
  return config.isProduction;
}

function providerToken(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined } }): string | undefined {
  // Prefer header — query tokens leak via logs, proxies, and history.
  return c.req.header("x-provider-token") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
}

app.post("/api/migrations", requireAuth, zValidator("json", migrationCreateBodySchema), async (c) => {
  const user = c.get("user")!;
  const body = getValidated<typeof migrationCreateBodySchema._output>(c, "json");
  const {
    source,
    sourceUrl,
    sourceBaseUrl,
    sourceOwner,
    sourceRepo,
    options,
    credentials,
  } = body;

  // Build the actual source URL based on source type
  let finalSourceUrl = sourceUrl;
  if (source !== "url" && sourceBaseUrl) {
    finalSourceUrl = `${sourceBaseUrl}/${sourceOwner}/${sourceRepo}.git`;
  } else if (source !== "url") {
    finalSourceUrl = `https://${source}.com/${sourceOwner}/${sourceRepo}.git`;
  }

  if (!finalSourceUrl || typeof finalSourceUrl !== "string") {
    return c.json({ error: "sourceUrl is required" }, 400);
  }

  const sourceCheck = validateOutboundUrl(finalSourceUrl, {
    requireHttps: requireHttpsOutbound(),
  });
  if (!sourceCheck.ok) {
    return c.json({ error: `Invalid source URL: ${sourceCheck.error}` }, 400);
  }

  if (sourceBaseUrl) {
    const baseErr = outboundUrlError(sourceBaseUrl, { requireHttps: requireHttpsOutbound() });
    if (baseErr) {
      return c.json({ error: `Invalid sourceBaseUrl: ${baseErr}` }, 400);
    }
  }

  // Create migration record
  const [migration] = await db
    .insert(repositoryMigrations)
    .values({
      userId: user.id,
      source,
      sourceUrl: finalSourceUrl,
      sourceBaseUrl: sourceBaseUrl || null,
      sourceOwner: sourceOwner || null,
      sourceRepo: sourceRepo || null,
      status: "pending",
      progress: 0,
      options: options || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  // Store credentials if provided (AES-GCM only; fails closed without key)
  if (credentials && (credentials.authToken || credentials.sshKey)) {
    try {
      await db.insert(migrationCredentials).values({
        migrationId: migration.id,
        authToken: credentials.authToken ? await encryptCredential(credentials.authToken) : null,
        authType: credentials.authType || "token",
        sshKey: credentials.sshKey ? await encryptCredential(credentials.sshKey) : null,
        sshKeyPassphrase: credentials.sshKeyPassphrase
          ? await encryptCredential(credentials.sshKeyPassphrase)
          : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      // Clean up migration if credential encryption fails
      await db.delete(repositoryMigrations).where(eq(repositoryMigrations.id, migration.id));
      console.error("[Migrations] Credential encryption failed:", err);
      return c.json(
        {
          error:
            "Failed to store migration credentials. Ensure MIGRATION_CREDENTIALS_KEY is configured.",
        },
        500
      );
    }
  }

  return c.json({ data: migration });
});

app.get("/api/migrations", requireAuth, async (c) => {
  const user = c.get("user")!;
  const limit = parseLimit(c.req.query("limit"), 20);
  const offset = parseOffset(c.req.query("offset"), 0);

  const migrations = await db
    .select()
    .from(repositoryMigrations)
    .where(eq(repositoryMigrations.userId, user.id))
    .orderBy(desc(repositoryMigrations.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = migrations.length > limit;
  const migrationsData = migrations.slice(0, limit);

  return c.json({ migrations: migrationsData, hasMore });
});

app.get("/api/migrations/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;

  const [migration] = await db
    .select()
    .from(repositoryMigrations)
    .where(
      and(
        eq(repositoryMigrations.id, id),
        eq(repositoryMigrations.userId, user.id)
      )
    );

  if (!migration) {
    return c.json({ error: "Migration not found" }, 404);
  }

  return c.json({ data: migration });
});

// Credentials are never exposed over HTTP. The migration worker reads them
// in-process via decryptCredential. Intentionally no public credentials route.

app.post("/api/migrations/:id/cancel", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;

  const [migration] = await db
    .select()
    .from(repositoryMigrations)
    .where(
      and(
        eq(repositoryMigrations.id, id),
        eq(repositoryMigrations.userId, user.id)
      )
    );

  if (!migration) {
    return c.json({ error: "Migration not found" }, 404);
  }

  if (migration.status === "completed" || migration.status === "failed") {
    return c.json({ error: "Cannot cancel completed migration" }, 400);
  }

  const cancelled = await db
    .update(repositoryMigrations)
    .set({ status: "failed", errorMessage: "Cancelled by user", updatedAt: new Date() })
    .where(and(eq(repositoryMigrations.id, id), eq(repositoryMigrations.userId, user.id), inArray(repositoryMigrations.status, ['pending', 'cloning', 'importing'])))
    .returning({ id: repositoryMigrations.id });
  if (!cancelled.length) return c.json({ error: 'Import already finished' }, 409);

  return c.json({ success: true });
});

app.delete("/api/migrations/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user")!;

  const [migration] = await db
    .select()
    .from(repositoryMigrations)
    .where(
      and(
        eq(repositoryMigrations.id, id),
        eq(repositoryMigrations.userId, user.id)
      )
    );

  if (!migration) {
    return c.json({ error: "Migration not found" }, 404);
  }

  const deleted = await db.delete(repositoryMigrations)
    .where(and(eq(repositoryMigrations.id, id), eq(repositoryMigrations.userId, user.id), inArray(repositoryMigrations.status, ['completed', 'failed'])))
    .returning({ id: repositoryMigrations.id });
  if (!deleted.length) return c.json({ error: 'Cancel the import before deleting it' }, 409);

  return c.json({ success: true });
});

// Normalized repo shape for list-repos responses
app.post('/api/migrations/:id/retry', requireAuth, async (c) => {
  const rows = await db.update(repositoryMigrations).set({ status: 'pending', progress: 0, errorMessage: null, startedAt: null, completedAt: null, updatedAt: new Date() })
    .where(and(eq(repositoryMigrations.id, c.req.param('id')), eq(repositoryMigrations.userId, c.get('user')!.id), eq(repositoryMigrations.status, 'failed')))
    .returning({ id: repositoryMigrations.id });
  if (!rows.length) return c.json({ error: 'Only failed imports can be retried' }, 409);
  return c.json({ success: true });
});

interface ListRepoItem {
  id: string;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
  url: string;
}

const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Provider APIs are public SaaS endpoints; still use guardedFetch for redirects/DNS.
    return await guardedFetch(url, {
      ...options,
      signal: controller.signal,
      requireHttps: requireHttpsOutbound(),
    });
  } finally {
    clearTimeout(timeout);
  }
}

// External service integrations — tokens via X-Provider-Token header only
app.get("/api/migrations/github/repos", requireAuth, async (c) => {
  const token = providerToken(c);

  if (!token) {
    return c.json({ error: "GitHub token required (X-Provider-Token header)" }, 400);
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    if (res.status === 401 || res.status === 403) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    if (!res.ok) {
      return c.json({ error: "Failed to fetch repositories from GitHub" }, 502);
    }
    const data = (await res.json()) as Array<{
      id: number;
      full_name: string;
      private: boolean;
      default_branch?: string;
      clone_url: string;
    }>;
    const repos: ListRepoItem[] = (data || []).map((r) => ({
      id: String(r.id),
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      url: r.clone_url,
    }));
    return c.json({ repos });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "Request timed out" }, 504);
    }
    throw err;
  }
});

app.get("/api/migrations/gitlab/repos", requireAuth, async (c) => {
  const token = providerToken(c);
  const baseUrl = (c.req.query("baseUrl") || "https://gitlab.com").replace(/\/$/, "");

  if (!token) {
    return c.json({ error: "GitLab token required (X-Provider-Token header)" }, 400);
  }

  const baseErr = outboundUrlError(baseUrl, { requireHttps: requireHttpsOutbound() });
  if (baseErr) {
    return c.json({ error: baseErr }, 400);
  }

  try {
    const url = `${baseUrl}/api/v4/projects?membership=true&per_page=100`;
    const res = await fetchWithTimeout(url, {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (res.status === 401 || res.status === 403) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    if (!res.ok) {
      return c.json({ error: "Failed to fetch repositories from GitLab" }, 502);
    }
    const data = (await res.json()) as Array<{
      id: number;
      path_with_namespace: string;
      visibility: string;
      default_branch?: string;
      http_url_to_repo: string;
    }>;
    const repos: ListRepoItem[] = (data || []).map((r) => ({
      id: String(r.id),
      fullName: r.path_with_namespace,
      private: r.visibility === "private",
      defaultBranch: r.default_branch,
      url: r.http_url_to_repo,
    }));
    return c.json({ repos });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "Request timed out" }, 504);
    }
    throw err;
  }
});

app.get("/api/migrations/gitea/repos", requireAuth, async (c) => {
  const token = providerToken(c);
  const baseUrl = c.req.query("baseUrl");

  if (!token) {
    return c.json({ error: "Gitea token required (X-Provider-Token header)" }, 400);
  }

  if (!baseUrl) {
    return c.json({ error: "Gitea base URL required" }, 400);
  }

  const normalizedBase = baseUrl.replace(/\/$/, "");
  const baseErr = outboundUrlError(normalizedBase, { requireHttps: requireHttpsOutbound() });
  if (baseErr) {
    return c.json({ error: baseErr }, 400);
  }

  try {
    const url = `${normalizedBase}/api/v1/user/repos?limit=50`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `token ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    if (!res.ok) {
      return c.json({ error: "Failed to fetch repositories from Gitea" }, 502);
    }
    const data = (await res.json()) as Array<{
      id: number;
      full_name: string;
      private: boolean;
      default_branch?: string;
      clone_url: string;
    }>;
    const repos: ListRepoItem[] = (data || []).map((r) => ({
      id: String(r.id),
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      url: r.clone_url,
    }));
    return c.json({ repos });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "Request timed out" }, 504);
    }
    throw err;
  }
});

app.get("/api/migrations/bitbucket/repos", requireAuth, async (c) => {
  const token = providerToken(c);

  if (!token) {
    return c.json({ error: "Bitbucket token required (X-Provider-Token header)" }, 400);
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.status === 401 || res.status === 403) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    if (!res.ok) {
      return c.json({ error: "Failed to fetch repositories from Bitbucket" }, 502);
    }
    const body = (await res.json()) as {
      values?: Array<{
        uuid: string;
        full_name?: string;
        name?: string;
        is_private?: boolean;
        mainbranch?: { name?: string };
        links?: { clone?: Array<{ href: string; name?: string }> };
      }>;
    };
    const values = body?.values ?? [];
    const repos: ListRepoItem[] = values.map((r) => {
      const cloneLink = r.links?.clone?.find((l) => l.name === "https") ?? r.links?.clone?.[0];
      return {
        id: r.uuid ?? String(r.name),
        fullName: r.full_name ?? r.name ?? "unknown",
        private: r.is_private ?? false,
        defaultBranch: r.mainbranch?.name,
        url: cloneLink?.href ?? "",
      };
    });
    return c.json({ repos });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return c.json({ error: "Request timed out" }, 504);
    }
    throw err;
  }
});

export default app;
