import { Hono } from "hono";
import { db, users, organizations, organizationMembers } from "@sigmagit/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthVariables } from "../middleware/auth";
import { listDirectoryPage, prefixExists } from "../storage";
import { listPackagePage } from "../registry/package-list";
import { isValidOciImageName } from "../registry/oci";
import { parseLimit } from "../lib/validation";
import { requestSignal } from "../lib/request-context";
import { listManifestRefs } from "../registry/storage";

const app = new Hono<{ Variables: AuthVariables }>();
/** Resolve username to owner (user or org). Returns owner type and whether current user can list. */
async function canListPackagesFor(
  currentUserId: string,
  ownerParam: string
): Promise<{ allowed: boolean; owner: string }> {
  const ownerLower = ownerParam.toLowerCase();
  const [userRow] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, currentUserId))
    .limit(1);
  if (userRow?.username?.toLowerCase() === ownerLower) {
    return { allowed: true, owner: userRow.username };
  }
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.name, ownerLower))
    .limit(1);
  if (!org) return { allowed: false, owner: ownerParam };
  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, currentUserId)
      )
    )
    .limit(1);
  if (!member) return { allowed: false, owner: ownerParam };
  return { allowed: true, owner: org.name };
}

// GET /api/users/:username/packages
app.get("/api/users/:username/packages", requireAuth, async (c) => {
  const username = c.req.param("username");
  const user = c.get("user")!;
  const { allowed, owner } = await canListPackagesFor(user.id, username);
  if (!allowed) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const after = c.req.query("after");
  if (after && !isValidOciImageName(after)) return c.json({ error: "Invalid package cursor" }, 400);
  return c.json(await listPackagePage({
    owner,
    limit: parseLimit(c.req.query("limit"), 20, 50),
    after,
    listDirectoryPage,
    hasPrefix: prefixExists,
    listRefs: listManifestRefs,
    signal: requestSignal(c.req.raw.signal),
  }));
});

// GET /api/users/:username/packages/:image/tags — :image may be URL-encoded (e.g. myorg%2Fnginx)
app.get("/api/users/:username/packages/:image/tags", requireAuth, async (c) => {
  const username = c.req.param("username");
  const image = decodeURIComponent(c.req.param("image"));
  const user = c.get("user")!;
  const { allowed, owner } = await canListPackagesFor(user.id, username);
  if (!allowed) {
    return c.json({ error: "Forbidden" }, 403);
  }
  try {
    const tags = await listManifestRefs(owner, image);
    return c.json({ name: `${owner}/${image}`, tags });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

// GET /api/organizations/:org/packages
app.get("/api/organizations/:org/packages", requireAuth, async (c) => {
  const org = c.req.param("org");
  const user = c.get("user")!;
  const { allowed, owner } = await canListPackagesFor(user.id, org);
  if (!allowed) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const after = c.req.query("after");
  if (after && !isValidOciImageName(after)) return c.json({ error: "Invalid package cursor" }, 400);
  return c.json(await listPackagePage({
    owner,
    limit: parseLimit(c.req.query("limit"), 20, 50),
    after,
    listDirectoryPage,
    hasPrefix: prefixExists,
    listRefs: listManifestRefs,
    signal: requestSignal(c.req.raw.signal),
  }));
});

export default app;
