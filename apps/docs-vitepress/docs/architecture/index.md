# Sigmagit Architecture

System architecture and design decisions for Sigmagit.

## 🏗️ High-Level Architecture

### Monorepo Structure

```
sigmagitv2/
├── apps/
│   ├── web/              # TanStack Start web application
│   ├── api/               # Hono API server (Bun)
│   └── discord-bot/      # Discord integration bot
├── packages/
│   ├── db/                # Drizzle ORM schema
│   ├── lib/               # Shared utilities
│   └── hooks/             # React Query hooks
├── docs/                   # Documentation
```

### Technology Stack

- **Runtime**: Bun 1.3.5+
- **Language**: TypeScript
- **Frontend**: React 19, TanStack Start, TailwindCSS
- **Backend**: Hono, Bun
- **Database**: PostgreSQL, Drizzle ORM
- **Git**: isomorphic-git
- **Storage**: S3-compatible or local filesystem
- **Auth**: better-auth
- **Email**: Resend or Nodemailer (SMTP)
- **Caching**: Redis (optional)
- **Real-time**: WebSocket + Redis Pub/Sub (optional)

## 🌐 Data Flow

### Request Flow

```
┌─────────────────────────────────────────────────────┐
│                     Browser / Mobile App                   │
└────────────────────────┬────────────────────────┘─┘
          │              │              │          │
          ▼              │              │          │
          ▼              │              │          │
    ┌──────┴──────┐              │          │
    │   ┌─────┐     │  │          │
    │   │Hono │     │ │ │          │
    │   └──────┘     │ │ │          │
    │        │Drizzle     │ │          │          │
    │        │    │     │ │          │
    │        └───────┴─┴─┴─┴┴┘
    │               │  │  │          │
    │               │ │ │          │
    │               │ │ │          │
    │               │ │ │          │
    │               │ │ │          │
    │               │ │ │ │          │
    │               │ │ │ │          │
    │               │ │ │ │          │
    │          │ │ │ │          │
    │               │ │ │          │          │
    │               │ │ │          │
    │               │ │ │ │          │          │
    └───────────────┴─┴─┴─┴─┴┴─┘
    └────────────────────┴─┴─┴─┴─�─┴─┴─�─┴┴─┴─�┴─
    │               │  │  │          │
    │               │ │ │          │          │
    │               │ │ │ │          │          │
    │               │ │ │ │          │ │
    │               │ │ │ │          │
    │               │ │ │ │          │          │
    └──────────────┴─┴─┴─�─┴─┴─┴┴┴┴┴┘
    │               │ │ │ │          │          │          │
    │               │ │ │ │          │          │
│               │ │ │ │          │          │          │
```

### User Authentication Flow

1. **Login**
   - User enters credentials in the web app
   - Credentials sent to `/auth/sign-in`
   - better-auth authenticates
   - Session created and stored in database
   - Session cookie returned

2. **Protected Route Access**
   - User makes request to protected route
   - Middleware validates session cookie
   - Auth context available to handlers

3. **Session Validation**
   - Middleware checks session in database
   - User object loaded and attached to context

## 🗄️ Database Schema

### Tables

```sql
users                    # User accounts
sessions                 # User sessions
repositories             # Git repositories
stars                   # Repository stars
forks                   # Repository forks
issues                  # Issues
pull_requests            # Pull requests
pr_labels              # PR labels
pr_assignees           # PR assignees
pr_reviewers           # PR reviews
pr_comments            # PR comments
issue_labels            # Issue labels
issue_assignees         # Issue assignees
issue_comments          # Issue comments
issue_reactions         # Issue reactions
notifications          # User notifications
repo_branch_metadata    # Branch metadata cache
discord_links           # Discord account links
link_tokens            # Discord link verification tokens
```

### Relationships

- Repositories → Users (owner, forkers)
- Issues → Repositories, Users (author, assignees)
- Pull Requests → Repositories (baseRepo, headRepo)
- Comments → Issues, Pull Requests
- Stars → Repositories, Users
- Reactions → Issues, Pull Requests, Comments

## 🔄 Caching Strategy

### Redis Caching (Optional)

### Cache Keys

```
sigmagit:session:{userId}
sigmagit:gitObject:{type}:{oid}
sigmagit:refs:{userId}:{repo}:{branch}
sigmagit:branches:{userId}:{repo}
sigmagit:tree:{userId}:{repo}:{branch}:{path}
sigmagit:file:{userId}:{repo}:{branch}:{path}
```

### Cache TTL

- Sessions: 1 hour
- Git objects: 24 hours
- Refs: 5 minutes
- Branches: 5 minutes
- Trees: 30 minutes
- Files: 1 hour
- Commits: 10 minutes

### Cache Invalidation

- Automatic invalidation on repository updates
- Manual invalidation on git push
- Cache pattern deletion for repository deletion

## 🎯 Git Storage Architecture

### Storage Backends

**S3 Storage** (Recommended)
- Scalable object storage
- Used for production deployments
- Automatic multipart upload for large files

**Local Storage** (Development)
- Filesystem-based storage
- No external dependencies
- Used for development and self-hosting

### Git Object Storage

**Structure:**
```
repos/{owner}/{repo}/objects/{prefix}/{suffix}/{object}
repos/{owner}/{repo}/refs/{ref-name}
repos/{owner}/{repo}/{ref}/heads/{branch-name}
repos/{owner}/{repo}/HEAD
```

### Storage Abstraction

**Interface:** `StorageBackend` with methods:
- `get(key)` - Retrieve object as Buffer
- `put(key, body, contentType?)` - Store object
- `delete(key)` - Delete object
- `exists(key)` - Check if object exists
- `list(prefix)` - List objects with prefix
- `deletePrefix(prefix)` - Delete all objects with prefix
- `copyPrefix(source, target)` - Copy objects between prefixes
- `getStream(key)` - Get object as ReadableStream

### Implementations**
- `S3StorageBackend` - AWS S3 SDK
- `LocalStorageBackend` - Bun filesystem

### Memory-Safe Operations

- Stream large files instead of loading into memory
- Batch operations with size limits
- Proper error handling and retries
- Resource cleanup on errors

## 📡 Real-Time Updates

### WebSocket Architecture

### Server-Sent Events

- **Issue Events**: New issue, close, reopen, edit
- **Pull Request Events**: New PR, close, merge
- **Push Events**: New commits
- **Star Events**: Star/unstar repository
- **Fork Events**: Repository forked

### WebSocket Flow

```
┌────────────────┐
│  Client (Web/Mobile)  │
└─────┬────────────────┘
┘                         │
│  ┌──┴──────┐      │
│  │  WebSocket     │      │
│  └──┴──┴──┴─┘      │
│                           │
│  ┌───────┴──────┴┐ │
│  │  │              │      │  │
│  │  │              │      │ │ │
│  │  │              │      │ │ │ │
└──┴┴─┴──┴──┴──┴─┴─┘─┴─┘
```

### Server-Sent Events

- **Push Notifications**: Send to WebSocket clients
- **Webhook Notifications**: Send to Discord webhooks

### Redis Pub/Sub (Optional)

**Channels:**
```
sigmagit:user:{userId}:notifications
sigmagit:repo:{owner}:{repo}:notifications
sigmagit:discord:{discordId}:notifications
```

### Message Format

```json
{
  "type": "issue" | "pull_request" | "push" | "star" | "fork",
  "repository": {
    "owner": "string",
    "name": "string"
  },
  "data": { ... }
}
```

## 🔐 Security

### Authentication

- better-auth session-based authentication
- Cookie-based session storage
- Secure session token encryption
- Rate limiting on auth endpoints

### Authorization

- Repository access control (public/private)
- Branch protection rules (TBD)

- Fork access control

### Data Protection

- SQL injection prevention via Drizzle ORM
- Input validation on all endpoints
- XSS protection in web app

- Secret management
- Environment variables for sensitive data
- Secure webhook signatures

### API Security

- CORS configuration
- Request size limits
- Rate limiting per endpoint
- Git push size limits (100MB)
- Maximum object count (50,000)

## 📊 Performance Optimizations

### Memory Management

- Git operations in batches
- Streaming large files
- Periodic garbage collection
- Request size limits
- Memory threshold monitoring (80% heap)
- Connection pooling

### Caching

- Redis caching with TTL
- HTTP response caching headers
- Database query optimization with indexes

### Database

- Connection pooling
- Optimized queries with proper indexes
- Batch operations for efficiency
- Prepared statements for repeated queries

### Git Operations

- Optimized git operations
- Object caching with Redis
- Parallel processing where possible
- Delta resolution with depth limits (max 100)

### Storage Operations

- Batch S3 operations
- Multipart uploads for large files
- Connection reuse with proper cleanup

### WebSocket

- Connection cleanup for stale connections
- 30-minute timeout
- Periodic cleanup job

## 🔧 Scalability

### Horizontal Scaling

- Stateless API server design
- Shared storage (S3 or database)
- Shared cache (Redis)
- Stateless web app

### Vertical Scaling

- Database connection pooling
- API server horizontal scaling
- Git operations can be distributed across instances

### Load Balancing

- Round-robin for API requests
- Session affinity for websocket connections
- Sticky sessions for web

## 🌐 Monitoring & Observability

### Application Metrics

### Health Checks

- `/health` endpoint - Server health status
- Database connection health
- Storage backend health
- Redis connection health

### Logging

- Structured logging with timestamps
- Request/response logging
- Error logging with context
- Performance metrics logging

### Metrics Collection

- API request count and latency
- Database query performance
- Git operation duration
- Storage operation duration
- WebSocket connection metrics
- Error rate by type

### Distributed Tracing (Future)

- OpenTelemetry or similar
- Request ID propagation
- Distributed log aggregation
- Performance dashboard integration

## 🚀 Deployment Architecture

### Production Setup

### API Server
```bash
# Environment variables required
- DATABASE_URL, BETTER_AUTH_SECRET
# Optional: REDIS_URL, STORAGE_TYPE, EMAIL_PROVIDER, DISCORD_WEBHOOK_URL

# Deployment options
- Bun runtime optimized for production
# Auto-scaling (cloud provider)
- Load balancer configuration
```

### Web App
```bash
# Static asset serving
# Environment-specific configuration
- CDN integration (optional)
# Rate limiting
```

### Database

```bash
# Connection pool sizing
# Read replica configuration
- Write replica configuration
```

### Storage

```bash
# S3 configuration
# Multi-region replication (optional)
# Lifecycle policies
```

### Monitoring

```bash
# Application Performance Monitoring (APM)
# Database query performance monitoring
# Storage operation monitoring
# Error rate and alerting
```

## 🔐 API Gateway (Future)

### Considerations

- Rate limiting per endpoint
- Request routing based on API path
- Request transformation
- API versioning strategy
- Circuit breaker pattern

## 📊 Service Communication

### Microservices Communication

Currently: Monolithic API server with clear boundaries

### Future: Separate services
- API server split by domain
- Event-driven communication
- Message queue (Redis Streams)

### Service Discovery

- Service registry (Consul/etcd)

## 🔧 Configuration Management

### Environment-Based Configuration

All configuration via environment variables

```bash
# Required
DATABASE_URL=
BETTER_AUTH_SECRET=

# Optional
STORAGE_TYPE=
S3_ENDPOINT=
REDIS_URL=
EMAIL_PROVIDER=
DISCORD_WEBHOOK_URL=
```

### Configuration Loading

- Type-safe configuration with validation
- Fallback to defaults
- Runtime validation

### Secrets Management

- Environment variables for sensitive data
- No hardcoded secrets in code
- GitHub Secrets or equivalent for deployment

## 🔄 State Management

### API Server

- Stateless where possible
- Session storage via database

### Web App

- Server state via TanStack Store
- Local persistence via TanStack Store

### Mobile App

- Local state via Zustand
- Persistence via AsyncStorage

### Discord Bot

- No persistent state required
- Each request is independent

### Cache Invalidation

- Automatic invalidation on data changes
- Tag-based cache invalidation
- Time-based expiration (TTL)

## 🚀 Error Handling

### Global Error Handler

- Catch-all error handler in API server
- Structured error responses
- Error logging with context

### Application Error Boundaries

- React error boundaries (web)
- Global error handler (web)
- Error reporting to monitoring service

### Error Classification

- Database errors (connection, query, constraint)
- Storage errors (not found, access denied)
- Git errors (invalid ref, merge conflict)
- API errors (validation, authentication)

### Error Recovery

- Automatic retry with exponential backoff
- Circuit breaker pattern for external services
- Fallback to alternative storage backend if S3 unavailable
- Graceful degradation on high load

## 📝 Load Balancing Strategy

### API Server

### Session affinity
- WebSocket connection affinity
- Database read replica routing
- Consistent hashing for storage access

### Web App

- Session-based routing
- Static asset CDN routing

### Mobile App

- No specific load balancing needed

### Discord Bot

- No load balancing needed (single instance)

## 🔒 Data Consistency

### Transaction Management

- Database transactions for multi-step operations
- Isolation levels for data consistency

### Git Operations

- Atomic ref updates
- Conflict detection and resolution
- Lock-free operations where possible

### Cache Invalidation

- Immediate invalidation on writes
- Tag-based invalidation strategy

### Eventual Consistency

- WebSocket notifications may be delayed
- Webhooks may arrive out of order
- Background sync processes for consistency

## 🛠️ Backup & Recovery

### Database Backups

- Scheduled dumps (pg_dump)
- Point-in-time recovery (WAL)
- Archive old data (partitioning)

### Git Backups

- Repository snapshots
- Full backup before destructive operations
- Incremental backups for efficiency

### Storage Backups

- S3 versioning (object versioning)
- Replication to backup region
- Backup retention policy

### Disaster Recovery

- Database restore from backup
- S3 restore from backups
- Git repository recovery from backup

### Recovery Testing

- Regular disaster recovery drills
- Failover testing
- Data integrity verification

## 📦 Development Workflow

### Setup

1. Clone repository
2. Install dependencies: `bun install`
3. Configure environment: `cp .env.example .env`
4. Run database migrations: `bun run db:push`
5. Start API server: `bun run dev:api`
6. Start other services as needed

### Code Review

- PR reviews for code quality
- TypeScript strict mode enforcement
- Security review for sensitive changes

### Testing Strategy

- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for critical paths
- Load testing for performance
- End-to-end tests for user flows

### Git Workflow

1. Create feature branch from `main`
2. Make changes in feature branch
3. Submit PR for review
4. Request code review
5. Update based on feedback
6. Merge to `main` after approval

### Deployment Workflow

1. Create PR from `develop` to `main`
2. Ensure tests pass and linting succeeds
3. Review and approve in PR
4. Merge to `main`
5. Deploy to staging environment
6. Smoke test in staging
7. Deploy to production

---

**Built with Bun, Hono, React, PostgreSQL, Redis**
