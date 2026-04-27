# peec-experiment-lab

> AI-Visibility A/B Experiment Lab — Peec MCP Challenge submission.
>
> Treat marketing content like code: hypothesis → PR → deployment → measured lift → verdict, all wired through Peec MCP.



Live Project : [https://xperimints-api-l1pk-cfhus344f.vercel.app/](https://xperimints-api-l1pk-cfhus344f.vercel.app/)

## Layout (Turborepo + pnpm)

```
peec-experiment-lab/
├── apps/
│   ├── web/                    # Next.js 16 (App Router) — auth, onboarding, dashboard, experiments UI
│   ├── api/                    # NestJS 11 — Peec sync, OAuth bridge, experiments + analysis services
│   ├── cli/                    # `npx peec-lab` for non-Cursor MCP hosts
│   └── mcp/                    # `xperi` MCP server — drives the lab from Cursor / Claude Desktop
├── packages/
│   ├── database/               # Prisma schema + generated client
│   ├── shared/                 # Zod schemas, DTOs, enums, stats math
│   ├── mcp-clients/            # Typed wrappers around all 27 Peec MCP tools + GitHub/Vercel/Linear
│   └── ui/                     # shadcn/ui re-exports + chart primitives
├── examples/
│   └── experiment-templates/   # Ready-to-fork experiment.yaml files
└── PLAN.md                     # Full architectural plan
```

## Getting started

```bash
pnpm install
cp .env.example .env            # then fill in DATABASE_URL, AUTH_SECRET, etc.
pnpm db:push                    # push Prisma schema to a local/Neon Postgres
pnpm dev                        # apps/web (3000) + apps/api (3001) + apps/mcp
```

Open [http://localhost:3000/signup](http://localhost:3000/signup) to create an account.

### Required env vars

The minimum to boot the app end-to-end:


| Variable                      | Purpose                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` / `DIRECT_URL` | Postgres connection (Neon recommended)                                                                                                                              |
| `AUTH_SECRET`                 | HS256 JWT signing key for the session cookie. Generate with `openssl rand -hex 32`. **Required in production**; dev falls back to a stable insecure value if unset. |
| `INTEGRATION_KMS_MASTER_KEY`  | 32-byte base64 key used to AES-256-GCM encrypt integration credentials at rest.                                                                                     |
| `PEEC_MCP_BASE_URL`           | Defaults to `https://api.peec.ai/mcp`. Override only for staging Peec instances.                                                                                    |
| `INTERNAL_API_URL`            | Defaults to `http://localhost:3001`. Web → API URL.                                                                                                                 |
| `NEXT_PUBLIC_APP_URL`         | Defaults to `http://localhost:3000`. Used in OAuth redirect URIs.                                                                                                   |


Optional: `OPENAI_API_KEY` (project descriptions + AI hypothesis generation), `LINEAR_API_KEY`, `GITHUB_WEBHOOK_SECRET`, `VERCEL_WEBHOOK_SECRET`, `BLOB_READ_WRITE_TOKEN`.

## Auth & onboarding flow

1. `**/signup`** — email + password. Each new account provisions its own
  `Organization` (slug derived from email) and an `OWNER` membership in
   a single transaction. Passwords are hashed with bcrypt; sessions are
   HS256 JWTs in HttpOnly cookies (see `apps/web/lib/auth.ts`).
2. `**/onboarding**` — gated behind `User.onboardedAt = null`. The screen
  walks the user through:
  - **Connect Peec** — OAuth 2.1 + PKCE popup against
  `https://api.peec.ai/mcp/authorize`. Tokens are encrypted with
  AES-256-GCM and stored on the user's `Integration` row.
  - **Pick a Peec project** — live `list_projects` against the
  connected workspace. Single-project workspaces auto-advance.
  - **Sync** — foreground `POST /v1/peec/sync` so the dashboard has
  prompts / brands / analytics on first render.
  - On success, `onboardedAt` is set and the user lands on `/dashboard`.
3. `**(app)` routes** — `/dashboard`, `/experiments`, `/integrations` are
  gated by `requireOnboardedUser()` in `apps/web/app/(app)/layout.tsx`.
   Anyone without a session goes to `/login`; signed-in but not-yet-
   onboarded users go to `/onboarding`.

There is **no seed script and no shared "demo" org** — every account is
its own self-contained workspace from the moment it signs up.

## Peec MCP tool coverage

`packages/mcp-clients` exposes all 27 Peec MCP tools as typed methods.
Active uses in the codebase:


| Surface                    | Tools wired up                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sync (refresh-from-Peec)   | `list_projects`, `list_models`, `list_brands`, `list_topics`, `list_tags`, `list_prompts`, `list_search_queries`, `get_brand_report` (3 dimensions), `get_url_report`, `get_actions` |
| Snapshots (per-experiment) | `get_brand_report`, `get_url_report`, `get_domain_report`, `get_url_content`                                                                                                         |
| Experiment lifecycle       | `create_topic` / `delete_topic`, `create_tag` / `delete_tag`                                                                                                                         |
| Verdict report             | `get_actions`, `list_chats` + `get_chat`, `list_brands`, `get_domain_report`                                                                                                         |
| Onboarding picker          | `list_projects` (live, no cache)                                                                                                                                                     |


Brand / prompt CRUD (`create_brand`, `update_brand`, `delete_brand`,
`create_prompt`, `update_prompt`, `delete_prompt`) are intentionally
**not** wired — Peec stays the system of record for those entities.

## Drive the lab from Cursor with `/xperi`

The repo ships with an MCP server (`apps/mcp`, package `@peec-lab/mcp`) that
exposes the experiment lab as a `xperi_`* tool family, plus a Cursor slash
command at `.cursor/commands/xperi.md`.

```bash
pnpm install
pnpm --filter @peec-lab/mcp build
# then restart Cursor — the project-scoped .cursor/mcp.json is auto-detected.
```

In Cursor:

```text
/xperi "create an experiment for the new pricing page, target Perplexity, +5pp"
```

The agent will resolve the connected Peec project, pick prompts, run a power
analysis, and call `xperi_create_experiment` — all mutations round-trip
through the NestJS API so the state machine stays authoritative. See
`[apps/mcp/README.md](./apps/mcp/README.md)` for the full tool surface and
Claude Desktop wiring.

## Tests

Statistical engine, state machine, YAML schema validation, and MCP wrappers all have unit tests:

```bash
pnpm test
```

Integration tests under `apps/api/src/modules/**/*integration.test.ts`
opt-in: they require `DATABASE_URL` set and are skipped otherwise. They
also expect at least one signed-up account with a connected Peec
project — sign up via `/signup` once before running them.

## Useful scripts

```bash
pnpm db:push        # apply Prisma schema changes to the live DB
pnpm db:generate    # regenerate the Prisma client
pnpm db:migrate     # interactive `prisma migrate dev` for schema iteration
pnpm typecheck      # tsc --noEmit across every workspace package
pnpm lint           # turbo run lint
pnpm format         # prettier --write
```

## Troubleshooting

- **API watcher dies mid-rebuild** (`Cannot find module '.../apps/api/dist/main'`)
Nest's `--watch` occasionally races itself when many files change at
once. Stop `pnpm dev` (`Ctrl-C`), kill any orphan API on `:3001`
(`pkill -f 'apps/api/dist/main.js'`), then restart `pnpm dev`.
- **Onboarding popup just shows the dashboard** — usually means the API
is unreachable. The popup posts to `/api/peec/oauth/start`, which
forwards to `localhost:3001`. Confirm the API is up at
`http://localhost:3001/healthz` and check `pnpm dev` for crashes.
- **"No Peec projects in your workspace"** during onboarding — create a
project in Peec, then click **Retry**. Onboarding cannot be skipped;
the dashboard depends on a populated `PeecProject` row.

