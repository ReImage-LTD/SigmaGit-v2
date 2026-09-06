# Sigmagit runner agent

The agent connects to the Sigmagit API using native Git and runs workflows through
the bundled act engine and Docker. Start Docker before starting the agent. Install
Git and the Go toolchain specified in `go.mod` to build it with `make build-agent`.

Set these environment variables on the runner host:

| Variable                                      | Purpose                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `SIGMAGIT_API_URL`                            | Reachable API origin, including scheme and port. Use HTTPS outside local development. |
| `SIGMAGIT_RUNNER_REGISTRATION_SECRET`         | Same value as the API's `RUNNER_REGISTRATION_SECRET`; used for initial registration.  |
| `SIGMAGIT_RUNNER_NAME`                        | Optional display name; defaults to the hostname.                                      |
| `SIGMAGIT_RUNNER_IMAGE`                       | Docker job image; defaults to `node:24-bookworm`.                                     |
| `SIGMAGIT_RUNNER_WORKDIR`                     | Local directory for temporary checkouts.                                              |
| `SIGMAGIT_CONFIG_PATH`                        | Saved runner ID/token file; defaults to `~/.sigmagit-runner/config.json`.             |
| `SIGMAGIT_RUNNER_ID`, `SIGMAGIT_RUNNER_TOKEN` | Optional existing credentials, overriding the saved file.                             |

Run `go run ./cmd/agent` from `apps/runner`, or launch the built agent binary.
Registration saves the issued credentials; subsequent starts reuse them. The shared
registration secret is not saved. Protect the credential file as a secret.

Apply database migration `0007_api_key_configuration.sql` through the project's
Drizzle migration workflow before starting this API version. It supplies Better
Auth's API-key configuration field and preserves existing keys.

Each newly dispatched workflow receives one runner assignment. Its complete job
graph executes together, preserving `needs`, job outputs and matrix dependencies.
The API displays one assignment with the captured steps. Individual jobs are not
distributed across runner hosts, and runner registration labels do not select a
host. The default image maps `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04` and
`self-hosted`; it is a Node/Debian image, not a full GitHub-hosted Ubuntu image.
Choose an image containing your tools. Unsupported platforms fail explicitly.
Use `actions/checkout` in jobs that need repository files. Assignment credentials
allow private Git reads while that assignment is active; they do not allow pushes.

Heartbeats continue during execution. API cancellation stops the running Docker
job; loss of heartbeats for two minutes causes the health worker to fail the
assignment and finalize its run. Logs use ordered, bounded uploads (64 KiB chunks,
1 MiB per captured step, at most 200 steps). Completion retries are idempotent.
This is not exactly-once execution across agent crashes; workflows should tolerate
an interrupted assignment being executed again after a restart.

## End-to-end regression test

The test requires Bun from the root `packageManager`, Go, Git, Docker, and a
**disposable local PostgreSQL instance**. From the repository root, start one:

```sh
docker run --detach --rm --name sigmagit-runner-e2e-postgres \
  -e POSTGRES_PASSWORD=runner-test-only -e POSTGRES_DB=runner_e2e \
  -p 127.0.0.1:55439:5432 postgres:16-alpine
```

Set `RUNNER_TEST_DATABASE_URL` to
`postgres://postgres:runner-test-only@127.0.0.1:55439/runner_e2e`, then run
`bun run test:runner-integration`. Set `GO_BINARY` if `go` is not on PATH.
Stop the disposable container afterward with
`docker stop sigmagit-runner-e2e-postgres`.

The harness refuses remote database hosts and other base database names. It creates
and removes its own randomly named database and temporary local Git storage. It
tests the API-key migration and authentication, browser-authenticated dispatch,
runner registration, private checkout at the assigned revision, dependent Docker
jobs, outputs, logs, concurrent assignment/progress, completion retries, access
revocation, cancellation, failed commands, unsupported platforms, missing commits,
and offline-run cleanup. Redis and S3 are disabled in this harness. The same test
runs in the security and quality CI workflow.
