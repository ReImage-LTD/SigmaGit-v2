# API Docker deployment

Use `apps/api/Dockerfile` for the API service. The root Compose stack builds this
image, migrates PostgreSQL before starting the API, persists local repositories,
and waits for dependency readiness before starting the web service.

## Configuration

Create the root `.env` on the deployment host; never commit it. Configure:

- `POSTGRES_PASSWORD`: a random, URL-safe password (the Compose database URL embeds it).
- `API_URL` and `WEB_URL`: the public HTTPS URLs served by your reverse proxy.
- `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`, `REGISTRY_JWT_SECRET`, and
  `WS_TICKET_SECRET`: four distinct random secrets, each at least 32 characters.
- `STORAGE_TYPE=local` for the persistent `/data/repos` volume, or `STORAGE_TYPE=s3`
  with `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and
  `S3_SECRET_ACCESS_KEY`. S3 readiness requires permission to inspect the bucket;
  repository operations also require object read/write/delete permissions.
- `INSTALLATION_SECRET`: a separate random secret of at least 32 characters for
  first-time installation. Without it, production installation is disabled.
- Configure SMTP or Resend before relying on email verification/password resets.
- `API_MEMORY_BUDGET_MB` sets the API process RSS budget (default 1024 MiB).
  Compose defaults `API_MEMORY_LIMIT` to `1280m` to leave headroom above that budget.
  When changing container limits, keep the process budget below the container limit.
  Admission and readiness return 503 at 92% of the budget and recover below 85%.
  Liveness stays available. Forced collection is limited to once per minute above
  90% RSS usage and runs outside the current request callback.
- `RUNNER_REGISTRATION_SECRET`: a separate random secret, required in production.

The supplied Caddyfile contains deployment-specific hostnames. Set those to your
domains before exposing the stack. Restrict trusted proxy CIDRs to your actual
proxy network. PostgreSQL and Redis must remain on the private Docker network.
Keep repository import workers disabled unless configured with their credential
encryption key. Workers atomically claim pending imports with PostgreSQL row locks,
so multiple instances cannot process the same pending job. Claims interrupted by
a process crash require operator review before requeueing; they are not automatically retried.

## Start and upgrade

```sh
docker compose build
docker compose up -d
docker compose ps
docker compose logs migrate api
```

Back up PostgreSQL and repository storage before upgrades. Migration `0008`
rebuilds generated search vectors and their GIN indexes, which takes table locks;
schedule a maintenance window for populated installations. Migration `0005a`
restores the missing organisation schema before the existing storage migration.
Already-applied migration timestamps are preserved.

Migration `0010` backfills repository star totals under a write lock on `stars`
and creates ranking/notification indexes. Allow a maintenance window for large
tables. Its triggers keep totals correct for inserts, deletes, transfers and
user-deletion cascades; apply the migration before deploying the updated API.

Notification lists return `nextCursor`; pass it as `cursor` for the next page.
Existing offset requests still work, but cursor and nonzero offset cannot be
combined. Cursors preserve PostgreSQL timestamp precision and use IDs to break ties.

Project lists, release lists/assets, gist comments, organisation members/teams/
invitations and the current user's organisations accept `limit` and `offset`.
They default to 30 rows, cap pages at 100, and return `hasMore` and `nextOffset`.
The SDK exposes optional pagination arguments; clients should follow `nextOffset`
when they need the full collection.

Databases previously managed with `db:push` or ad-hoc SQL need their schema and
migration ledger reconciled before using this migration path. Do not mark
migrations applied blindly, run `db:push` against production, or delete volumes
to resolve a migration failure. Rehearse the upgrade on a restored backup.

For an explicit migration step using the built image:

```sh
docker compose run --rm migrate
```

For first installation, send `POST /api/install` over HTTPS with
`Authorization: Bearer <INSTALLATION_SECRET>` and JSON containing `name`,
`username`, `email`, and `password`. The admin and password account are created
atomically; concurrent attempts cannot create additional admins. Normal signup
is blocked until installation completes. Remove the installation secret and
recreate the API container afterward. Sign in through the normal login flow.

## Health and shutdown

- `/health` is liveness, independent of database/auth availability.
- `/ready` checks the migration ledger, PostgreSQL, configured session Redis,
  and local storage permissions or S3 bucket access. Failure returns HTTP 503.
  Optional cache Redis does not block readiness.
- Probes are coalesced, cached for one second and bounded to three seconds.
- SIGTERM drains HTTP requests and active background workers for up to 25 seconds.
  Compose gives the container 30 seconds. A forced timeout exits nonzero.
- Repository files survive container replacement in `repositories_data`.
  Never use `docker compose down -v` on an installation you want to preserve.

Readiness cannot prove outbound email delivery, external runner reachability,
S3 object permissions, backup restoration, or capacity under your workload.
Verify those against your deployment before accepting traffic.

## Reproduce the isolated deployment checks

```sh
docker build -f apps/api/Dockerfile -t sigmagit-api-production-test .
bun run apps/api/integration/docker-smoke.ts
```

This creates disposable PostgreSQL, Redis, API containers and a storage volume.
It tests fresh/repeated/concurrent migrations, protected concurrent installation,
production login cookies, shutdown, storage persistence, and dependency outage
recovery. Resources are removed in a `finally` block. It does not read `.env`.
