# Development Guide

This guide covers how to set up your development environment and contribute to Sigmagit.

## Prerequisites

- **Bun** 1.3.5 or higher (JavaScript runtime and package manager)
- **Node.js** 18+ (for some tooling)
- **PostgreSQL** 15+ (for local development)
- **Redis** 7+ (optional, for caching and webhooks)
- **Git** (for version control)

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://git.sigmagaming.net/SigmaGaming/SimgaGit-v2
.git
   cd sigmagit
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Initialize the database:
   ```bash
   bun run db:push
   ```

5. Start the development servers:
   ```bash
   # Start web app + API server (ports 3000, 3001)
   bun run dev:web
   ```

## Development Workflow

### Running Tests

```bash
# Run all tests
cd apps/web && bun run test

# Run specific test pattern
cd apps/web && bunx vitest run <pattern>

# Watch mode for development
cd apps/web && bunx vitest watch
```

### Linting and Type Checking

```bash
# Lint all packages
bun run lint

# Or via turbo
turbo lint

# Type check (package-specific)
cd apps/web && bun run typecheck
```

### Building

```bash
# Build all applications
bun run build

# Build all via turbo
turbo build
```

## Database Operations

### Schema Changes

1. Modify `packages/db/src/schema.ts`
2. Generate migrations:
   ```bash
   bun run db:generate
   ```
3. Apply migrations:
   ```bash
   bun run db:migrate
   ```

### Database Studio

```bash
bun run db:studio
```

## Package Scripts

### Root Package

- `bun install` - Install all dependencies
- `bun run dev:web` - Start web app + API
- `bun run build` - Build all apps
- `bun run lint` - Lint all packages
- `bun run db:push` - Push schema to database
- `bun run db:generate` - Generate Drizzle migrations
- `bun run db:migrate` - Apply migrations
- `bun run db:studio` - Open Drizzle Studio

### Web App (`apps/web`)

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run test` - Run tests
- `bun run lint` - Lint code
- `bun run typecheck` - TypeScript type check

### API (`apps/api`)

- `bun run dev` - Start API server
- `bun run build` - Build for production
- `bun run lint` - Lint code
- `bun run typecheck` - TypeScript type check

### Discord Bot (`apps/discord-bot`)

- `bun run dev` - Start bot in watch mode
- `bun run start` - Start bot normally
- `bun run register` - Register slash commands

### Database Package (`packages/db`)

- `bun run push` - Push schema changes
- `bun run generate` - Generate migrations
- `bun run migrate` - Apply migrations
- `bun run studio` - Open Drizzle Studio

## Code Style

We use Prettier for code formatting with the following conventions:

- Line width: 100 characters
- Indentation: 2 spaces (no tabs)
- Semicolons: required
- Quotes: single quotes
- Imports are auto-sorted

To format code:
```bash
bunx prettier --write .
```

## Project Structure

```
sigmagit/
├── apps/
│   ├── web/           # TanStack Start web application
│   ├── api/           # Hono API server
│   └── discord-bot/   # Discord.js bot
├── packages/
│   ├── db/            # Drizzle ORM schema
│   ├── lib/           # Shared utilities
│   └── hooks/         # React Query hooks
├── docs/              # Documentation
└── AGENTS.md          # Agent development guidelines
```

## Adding New Features

1. Define types in relevant package
2. Add database schema if needed
3. Create API routes in `apps/api/src/routes/`
4. Add React Query hooks in `packages/hooks/src/`
5. Build UI components in `apps/web/`
6. Write tests for new functionality
7. Update documentation

## Troubleshooting

### Port Already in Use

If ports 3000 or 3001 are already in use:
- Kill the process: `lsof -ti:3000 | xargs kill`
- Or change ports in environment variables

### Database Connection Issues

- Ensure PostgreSQL is running
- Check `DATABASE_URL` in `.env`
- Verify database exists: `psql -U postgres -l`

### Import/Export Issues

- Clear node_modules: `rm -rf node_modules && bun install`
- Rebuild packages: `turbo build`

## Getting Help

- Check existing documentation in `docs/`
- Review `AGENTS.md` for agent-specific guidelines
- Look at existing code for patterns and conventions
