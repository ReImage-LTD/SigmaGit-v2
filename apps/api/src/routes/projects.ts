import { listPage, pageResponse } from '../lib/list-page';
import {
  db,
  users,
  repositories,
  projects,
  projectColumns,
  projectItems,
  issues,
  pullRequests,
} from '@sigmagit/db';
import { canAccessRepository, canManageRepository } from '../lib/access';
import { requireAuth, type AuthVariables } from '../middleware/auth';
import { resolveRepositoryWithAccess } from '../lib/repo-helpers';
import { eq, sql, and, asc, inArray } from 'drizzle-orm';
import { formatZodError } from '../middleware/validate';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono<{ Variables: AuthVariables }>();

const positionSchema = z.number().int().min(0).max(2_147_483_647);
const itemCreateSchema = z
  .object({
    columnId: z.string().uuid(),
    issueId: z.string().uuid().optional(),
    pullRequestId: z.string().uuid().optional(),
    noteContent: z.string().trim().min(1).max(65_536).optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.issueId, value.pullRequestId, value.noteContent].filter((value) => value !== undefined)
        .length === 1,
    { message: 'Provide exactly one issue, pull request, or note' },
  );
const itemUpdateSchema = z
  .object({
    columnId: z.string().uuid().optional(),
    position: positionSchema.optional(),
    noteContent: z.string().max(65_536).optional(),
  })
  .strict();
const itemReorderSchema = z
  .object({
    items: z
      .array(
        z
          .object({ id: z.string().uuid(), columnId: z.string().uuid(), position: positionSchema })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

async function enrichProjectItem(item: typeof projectItems.$inferSelect, repositoryId: string) {
  if (item.issueId) {
    const issue = await db.query.issues.findFirst({
      where: and(eq(issues.id, item.issueId), eq(issues.repositoryId, repositoryId)),
    });
    if (issue) {
      const author = await db.query.users.findFirst({
        where: eq(users.id, issue.authorId),
        columns: { id: true, username: true, name: true, avatarUrl: true },
      });
      return {
        id: item.id,
        type: 'issue' as const,
        position: item.position,
        issue: {
          id: issue.id,
          number: issue.number,
          title: issue.title,
          state: issue.state,
          author,
        },
      };
    }
  }

  if (item.pullRequestId) {
    const pr = await db.query.pullRequests.findFirst({
      where: and(
        eq(pullRequests.id, item.pullRequestId),
        eq(pullRequests.repositoryId, repositoryId),
      ),
    });
    if (pr) {
      const author = await db.query.users.findFirst({
        where: eq(users.id, pr.authorId),
        columns: { id: true, username: true, name: true, avatarUrl: true },
      });
      return {
        id: item.id,
        type: 'pull_request' as const,
        position: item.position,
        pullRequest: {
          id: pr.id,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author,
        },
      };
    }
  }

  if (item.noteContent) {
    return {
      id: item.id,
      type: 'note' as const,
      position: item.position,
      noteContent: item.noteContent,
    };
  }

  return null;
}

app.get('/api/repositories/:owner/:name/projects', async (c) => {
  const { limit, offset } = listPage(c.req.query());
  const owner = c.req.param('owner');
  const name = c.req.param('name');
  const currentUser = c.get('user');

  const repoAccess = await resolveRepositoryWithAccess(owner, name, currentUser);
  if (!repoAccess) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const projectList = await db
    .select()
    .from(projects)
    .where(eq(projects.repositoryId, repoAccess.id))
    .orderBy(projects.createdAt, projects.id)
    .limit(limit + 1)
    .offset(offset);

  return c.json(pageResponse('projects', projectList, limit, offset));
});

app.post('/api/repositories/:owner/:name/projects', requireAuth, async (c) => {
  const owner = c.req.param('owner');
  const name = c.req.param('name');
  const user = c.get('user')!;
  const body = await c.req.json<{ name: string; description?: string }>();

  const repoAccess = await resolveRepositoryWithAccess(owner, name, user);
  if (!repoAccess) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (!(await canManageRepository(repoAccess, user))) {
    return c.json({ error: 'Only repo owner can create projects' }, 403);
  }

  if (!body.name?.trim()) {
    return c.json({ error: 'Project name is required' }, 400);
  }

  const [inserted] = await db
    .insert(projects)
    .values({
      repositoryId: repoAccess.id,
      name: body.name,
      description: body.description,
    })
    .returning();

  const defaultColumns = ['To Do', 'In Progress', 'Done'];
  for (let i = 0; i < defaultColumns.length; i++) {
    await db.insert(projectColumns).values({
      projectId: inserted.id,
      name: defaultColumns[i],
      position: i,
    });
  }

  return c.json(inserted);
});

app.get('/api/projects/:id', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
  });

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, project.repositoryId),
  });

  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (!(await canAccessRepository(repo, currentUser))) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const columns = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.projectId, id))
    .orderBy(asc(projectColumns.position));

  if (columns.length === 0) {
    return c.json({
      id: project.id,
      name: project.name,
      description: project.description,
      columns: [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  }

  const columnIds = columns.map((c) => c.id);
  const allItems = await db
    .select()
    .from(projectItems)
    .where(and(eq(projectItems.projectId, project.id), inArray(projectItems.columnId, columnIds)))
    .orderBy(asc(projectItems.position));

  const issueIds = [...new Set(allItems.filter((i) => i.issueId).map((i) => i.issueId!))];
  const prIds = [...new Set(allItems.filter((i) => i.pullRequestId).map((i) => i.pullRequestId!))];

  const [issueRows, prRows] = await Promise.all([
    issueIds.length
      ? db
          .select()
          .from(issues)
          .where(and(inArray(issues.id, issueIds), eq(issues.repositoryId, repo.id)))
      : Promise.resolve([]),
    prIds.length
      ? db
          .select()
          .from(pullRequests)
          .where(and(inArray(pullRequests.id, prIds), eq(pullRequests.repositoryId, repo.id)))
      : Promise.resolve([]),
  ]);
  const authorIds = [...new Set([...issueRows, ...prRows].map((item) => item.authorId))];
  const authors = authorIds.length
    ? await db
        .select({
          id: users.id,
          username: users.username,
          name: users.name,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(inArray(users.id, authorIds))
    : [];
  const usersById = new Map(authors.map((author) => [author.id, author]));

  const issuesById = new Map(issueRows.map((i) => [i.id, i]));
  const prsById = new Map(prRows.map((p) => [p.id, p]));

  function enrichItem(item: typeof projectItems.$inferSelect):
    | {
        id: string;
        type: 'issue';
        position: number;
        issue: {
          id: string;
          number: number;
          title: string;
          state: string;
          author: { id: string; username: string; name: string; avatarUrl: string | null };
        };
      }
    | {
        id: string;
        type: 'pull_request';
        position: number;
        pullRequest: {
          id: string;
          number: number;
          title: string;
          state: string;
          author: { id: string; username: string; name: string; avatarUrl: string | null };
        };
      }
    | { id: string; type: 'note'; position: number; noteContent: string | null }
    | null {
    if (item.issueId) {
      const issue = issuesById.get(item.issueId);
      if (issue) {
        const author = usersById.get(issue.authorId) ?? {
          id: issue.authorId,
          username: 'unknown',
          name: 'Unknown',
          avatarUrl: null,
        };
        return {
          id: item.id,
          type: 'issue' as const,
          position: item.position,
          issue: {
            id: issue.id,
            number: issue.number,
            title: issue.title,
            state: issue.state,
            author,
          },
        };
      }
    }
    if (item.pullRequestId) {
      const pr = prsById.get(item.pullRequestId);
      if (pr) {
        const author = usersById.get(pr.authorId) ?? {
          id: pr.authorId,
          username: 'unknown',
          name: 'Unknown',
          avatarUrl: null,
        };
        return {
          id: item.id,
          type: 'pull_request' as const,
          position: item.position,
          pullRequest: { id: pr.id, number: pr.number, title: pr.title, state: pr.state, author },
        };
      }
    }
    if (item.noteContent != null) {
      return {
        id: item.id,
        type: 'note' as const,
        position: item.position,
        noteContent: item.noteContent,
      };
    }
    return null;
  }

  const itemsByColumnId = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const list = itemsByColumnId.get(item.columnId) ?? [];
    list.push(item);
    itemsByColumnId.set(item.columnId, list);
  }

  const columnsWithItems = columns.map((column) => {
    const items = (itemsByColumnId.get(column.id) ?? []).sort((a, b) => a.position - b.position);
    const enrichedItems = items
      .map(enrichItem)
      .filter((x): x is NonNullable<typeof x> => x != null);
    return { id: column.id, name: column.name, position: column.position, items: enrichedItems };
  });

  return c.json({
    id: project.id,
    name: project.name,
    description: project.description,
    columns: columnsWithItems,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
});

app.patch('/api/projects/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = await c.req.json<{ name?: string; description?: string }>();

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
  });

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, project.repositoryId),
  });

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can update projects' }, 403);
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;

  await db.update(projects).set(updates).where(eq(projects.id, id));

  return c.json({ success: true });
});

app.delete('/api/projects/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
  });

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, project.repositoryId),
  });

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can delete projects' }, 403);
  }

  await db.delete(projects).where(eq(projects.id, id));

  return c.json({ success: true });
});

app.post('/api/projects/:id/columns', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = await c.req.json<{ name: string }>();

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
  });

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, project.repositoryId),
  });

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can add columns' }, 403);
  }

  const [maxPosition] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(projectColumns)
    .where(eq(projectColumns.projectId, id));

  const [inserted] = await db
    .insert(projectColumns)
    .values({
      projectId: id,
      name: body.name,
      position: (maxPosition?.max ?? -1) + 1,
    })
    .returning();

  return c.json(inserted);
});

app.patch('/api/projects/columns/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = await c.req.json<{ name?: string; position?: number }>();

  const column = await db.query.projectColumns.findFirst({
    where: eq(projectColumns.id, id),
  });

  if (!column) {
    return c.json({ error: 'Column not found' }, 404);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, column.projectId),
  });

  const repo = project
    ? await db.query.repositories.findFirst({
        where: eq(repositories.id, project.repositoryId),
      })
    : null;

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can update columns' }, 403);
  }

  const updates: Record<string, any> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.position !== undefined) updates.position = body.position;

  if (Object.keys(updates).length > 0) {
    await db.update(projectColumns).set(updates).where(eq(projectColumns.id, id));
  }

  return c.json({ success: true });
});

app.delete('/api/projects/columns/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;

  const column = await db.query.projectColumns.findFirst({
    where: eq(projectColumns.id, id),
  });

  if (!column) {
    return c.json({ error: 'Column not found' }, 404);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, column.projectId),
  });

  const repo = project
    ? await db.query.repositories.findFirst({
        where: eq(repositories.id, project.repositoryId),
      })
    : null;

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can delete columns' }, 403);
  }

  await db.delete(projectColumns).where(eq(projectColumns.id, id));

  return c.json({ success: true });
});

app.post('/api/projects/:id/items', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const parsed = itemCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const body = parsed.data;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, id),
  });

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, project.repositoryId),
  });

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can add items' }, 403);
  }

  const column = await db.query.projectColumns.findFirst({
    where: and(eq(projectColumns.id, body.columnId), eq(projectColumns.projectId, project.id)),
  });
  if (!column) return c.json({ error: 'Invalid column for project' }, 400);
  if (
    body.issueId &&
    !(await db.query.issues.findFirst({
      where: and(eq(issues.id, body.issueId), eq(issues.repositoryId, project.repositoryId)),
      columns: { id: true },
    }))
  ) {
    return c.json({ error: 'Issue not found' }, 404);
  }
  if (
    body.pullRequestId &&
    !(await db.query.pullRequests.findFirst({
      where: and(
        eq(pullRequests.id, body.pullRequestId),
        eq(pullRequests.repositoryId, project.repositoryId),
      ),
      columns: { id: true },
    }))
  ) {
    return c.json({ error: 'Pull request not found' }, 404);
  }

  const [maxPosition] = await db
    .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
    .from(projectItems)
    .where(eq(projectItems.columnId, body.columnId));

  const [inserted] = await db
    .insert(projectItems)
    .values({
      projectId: id,
      columnId: body.columnId,
      issueId: body.issueId || null,
      pullRequestId: body.pullRequestId || null,
      noteContent: body.noteContent || null,
      position: (maxPosition?.max ?? -1) + 1,
    })
    .returning();

  const enriched = await enrichProjectItem(inserted, project.repositoryId);

  return c.json(enriched);
});

app.patch('/api/projects/items/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const parsed = itemUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const body = parsed.data;

  const item = await db.query.projectItems.findFirst({
    where: eq(projectItems.id, id),
  });

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, item.projectId),
  });

  const repo = project
    ? await db.query.repositories.findFirst({
        where: eq(repositories.id, project.repositoryId),
      })
    : null;

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can update items' }, 403);
  }

  if (
    body.columnId &&
    !(await db.query.projectColumns.findFirst({
      where: and(
        eq(projectColumns.id, body.columnId),
        eq(projectColumns.projectId, item.projectId),
      ),
      columns: { id: true },
    }))
  ) {
    return c.json({ error: 'Invalid column for project' }, 400);
  }
  const updates: Partial<typeof projectItems.$inferInsert> = {};
  if (body.columnId !== undefined) updates.columnId = body.columnId;
  if (body.position !== undefined) updates.position = body.position;
  if (body.noteContent !== undefined) updates.noteContent = body.noteContent;

  if (Object.keys(updates).length > 0) {
    await db.update(projectItems).set(updates).where(eq(projectItems.id, id));
  }

  return c.json({ success: true });
});

app.post('/api/projects/items/reorder', requireAuth, async (c) => {
  const user = c.get('user')!;
  const parsed = itemReorderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const body = parsed.data;

  if (!body.items?.length) {
    return c.json({ error: 'Items array is required' }, 400);
  }
  if (body.items.length > 500) {
    return c.json({ error: 'Too many items' }, 400);
  }

  const itemIds = body.items.map((i) => i.id);
  const loadedItems = await db.query.projectItems.findMany({
    where: inArray(projectItems.id, itemIds),
  });

  if (loadedItems.length !== itemIds.length) {
    return c.json({ error: 'One or more items not found' }, 404);
  }

  const projectIds = [...new Set(loadedItems.map((i) => i.projectId))];
  if (projectIds.length !== 1) {
    return c.json({ error: 'All items must belong to the same project' }, 400);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectIds[0]!),
  });

  const repo = project
    ? await db.query.repositories.findFirst({
        where: eq(repositories.id, project.repositoryId),
      })
    : null;

  if (!project || !repo || user.id !== repo.ownerId) {
    return c.json({ error: 'Only repo owner can reorder items' }, 403);
  }

  // Ensure column targets belong to the same project (prevent cross-project moves).
  const columnIds = [...new Set(body.items.map((i) => i.columnId).filter(Boolean))];
  if (columnIds.length) {
    const cols = await db.query.projectColumns.findMany({
      where: inArray(projectColumns.id, columnIds),
    });
    if (cols.length !== columnIds.length || cols.some((col) => col.projectId !== project!.id)) {
      return c.json({ error: 'Invalid column for project' }, 400);
    }
  }

  await db.transaction(async (tx) => {
    for (const item of body.items) {
      const updated = await tx
        .update(projectItems)
        .set({ columnId: item.columnId, position: item.position })
        .where(and(eq(projectItems.id, item.id), eq(projectItems.projectId, project.id)))
        .returning({ id: projectItems.id });
      if (updated.length !== 1) throw new Error('Project item changed during reorder');
    }
  });

  return c.json({ success: true });
});

app.delete('/api/projects/items/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;

  const item = await db.query.projectItems.findFirst({
    where: eq(projectItems.id, id),
  });

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, item.projectId),
  });

  const repo = project
    ? await db.query.repositories.findFirst({
        where: eq(repositories.id, project.repositoryId),
      })
    : null;

  if (user.id !== repo?.ownerId) {
    return c.json({ error: 'Only repo owner can delete items' }, 403);
  }

  await db.delete(projectItems).where(eq(projectItems.id, id));

  return c.json({ success: true });
});

export default app;
