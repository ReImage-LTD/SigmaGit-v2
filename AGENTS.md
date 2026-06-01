# AGENTS.md

This file contains guidelines for agentic coding assistants working in this repository.

## Development Commands

**Package Manager:** Bun 1.3.5+

### Common Commands
- `bun install` - Install dependencies
- `bun run dev:web` - Start web app + API server (ports 3000, 3001)
- `bun run dev:discord` - Start Discord bot only
- `bun run build` - Build all applications (turbo)
- `bun run lint` - Lint all packages
- `turbo lint` - Lint all packages via turbo
- `turbo build` - Build all packages via turbo

### Testing
- `cd apps/web && bun run test` - Run all tests (Vitest)
- `cd apps/web && bunx vitest run <pattern>` - Run tests matching pattern
- `cd apps/web && bunx vitest watch` - Watch mode for development
- `cd apps/web && bunx vitest run <test-file>` - Run single test file

### Database
- `bun run db:push` - Push schema changes to database
- `bun run db:generate` - Generate Drizzle migrations
- `bun run db:migrate` - Apply migrations
- `bun run db:studio` - Open Drizzle Studio

### Package-specific Commands
- `cd apps/web && bun run dev` - Start web dev server
- `cd apps/api && bun run dev` - Start API server
- `cd apps/api && bun run build` - Build API for production
- `cd apps/discord-bot && bun run register` - Register Discord slash commands

## Code Style Guidelines

### Formatting
- Prettier config: 100 char width, 2 spaces, semicolons, single quotes
- Imports auto-sorted via `prettier-plugin-sort-imports`
- Tailwind classes sorted via `prettier-plugin-tailwindcss`

### TypeScript
- Strict mode enabled
- Use `interface` for object shapes, `type` for unions/primitives
- Export types with `export type` where appropriate
- Avoid `any`; use `unknown` or proper types
- Type exports for React Query hooks

### Import Order
1. External libraries (React, TanStack, Lucide, etc.)
2. Workspace packages (@sigmagit/*)
3. Relative imports using `@/` alias (web)
4. Type imports grouped together

```typescript
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { timeAgo } from "@sigmagit/lib";
import { useRepositoryInfo } from "@sigmagit/hooks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Repository } from "@/types";
```

### Naming Conventions
- Components: PascalCase (`RepositoryCard`, `StarButton`)
- Functions/variables: camelCase (`getRepositoryInfo`, `toggleStar`)
- Types/interfaces: PascalCase (`Repository`, `UserPreferences`)
- Constants: UPPER_SNAKE_CASE (`API_BASE_URL`)
- Files: kebab-case (`repo-card.tsx`, `star-button.tsx`)

### Component Patterns
- Functional components with TypeScript props interfaces
- Add `"use client";` for client components
- Extract props to interface, use `cn()` for className merging
- Destructure props in function signature

```typescript
"use client";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StarButtonProps {
  repository: RepositoryWithStars;
  className?: string;
}

export function StarButton({ repository, className }: StarButtonProps) {
  return <Button className={cn("gap-2", className)}>...</Button>;
}
```

### API Routes (Hono)
- Use typed handlers: `Hono<{ Variables: AuthVariables }>`
- Apply middleware at route level with `app.use("*", middleware)`
- Return proper HTTP status codes with JSON responses
- Use `c.req.param()`, `c.req.json()`, `c.req.query()` for input
- Validate inputs, return errors as `{ error: "message" }`

```typescript
import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/auth";

const app = new Hono<{ Variables: AuthVariables }>();
app.use("*", authMiddleware);

app.get("/api/repositories/:id", requireAuth, async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ data: result });
});
```

### React Query Hooks
- Place in `packages/hooks/src` by feature domain
- Use `useApi()` context for API calls
- Query keys: `["resource", "id", "action"]`
- Enable conditionally with `enabled`
- Mutations invalidate related queries on success

```typescript
export function useRepositoryInfo(owner: string, name: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["repository", owner, name, "info"],
    queryFn: () => api.repositories.getInfo(owner, name),
    enabled: !!owner && !!name,
  });
}
```

### Database (Drizzle ORM)
- Schema in `packages/db/src/schema.ts`
- Use `pgTable` for table definitions
- Export tables and relations
- Type columns with `.$type<>()` for complex types
- Use indexes for frequently queried fields

### Error Handling
- Use try-catch in async functions
- Log errors with context for debugging
- Return user-friendly error messages
- Handle null/undefined with optional chaining
- Validate inputs before processing
- Use proper HTTP status codes in API routes

### Tailwind CSS
- Use utility classes exclusively
- Prefer semantic colors (primary, secondary, muted)
- Use `size-*` for width/height, `gap-*` for spacing
- Responsive prefixes: `md:`, `lg:`
- Use `@/lib/utils` `cn()` for conditional classes
- Icons use `size-*` pattern from lucide-react

### File Organization
- Components grouped by feature/domain
- Shared UI in `components/ui/`
- Hooks in `packages/hooks/src/`
- Utilities in `packages/lib/src/`
- Types inline or in separate types files

## Architecture Notes

- Monorepo managed by Turbo
- Web app: TanStack Start with file-based routing
- API: Hono with Bun runtime
- Git operations: isomorphic-git with S3 storage
- Auth: better-auth (email/password + passkeys)
- Real-time: Redis + WebSocket (optional)
