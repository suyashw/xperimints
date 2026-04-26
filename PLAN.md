# AI-Visibility A/B Experiment Lab — Build Plan (Vercel Hobby)

> Treat marketing content like code: hypothesis → PR → deployment → measured lift → verdict, all wired through Peec MCP.

Stack: **Next.js 16 (App Router)** · **NestJS 11** · **Postgres (Neon, via Vercel Marketplace)** · deployed on **Vercel Hobby** as two projects in one Turborepo.

> **Submission target:** Peec MCP Challenge — primary category **Reporting Automation**, secondary **Content Optimization**. Deadline **April 26**. See §8 for the 4-day compressed roadmap.

> This plan is sized for the **Vercel Hobby (free) plan**. See §7.1 for the exact constraints we design around (once-per-day cron, 60s default function ceiling, non-commercial use).

---

## 1. Product Surface (what a user actually does)

1. Connects Peec, GitHub, Vercel, Linear via OAuth/PAT in `/integrations`. Project picker is powered by `list_projects`.
2. Picks a Peec project; the app caches its prompts, brands, engines, topics, tags via `list_prompts`, `list_brands`, `list_models`, `list_topics`, `list_tags`.
3. Drops an `experiment.yaml` into their marketing repo and opens a PR labeled `geo-experiment`.
4. App parses the YAML on PR open → creates an Experiment in `draft` → runs **power analysis** → comments on the PR with “detectable lift = X pp at 80% power; recommended duration = Y days.” At this step we also call `create_topic` and `create_tag` so the experiment has a clean grouping inside Peec's own dashboards.
5. PR merges → Vercel deploy webhook stamps the *real* launch time → Experiment becomes `running`. We snapshot the treatment URL with `get_url_content` immediately so we can prove the change shipped.
6. Daily cron snapshots metrics for treatment + control prompt sets via `get_brand_report` + `get_url_report` + `get_domain_report`.
7. At `launch_date + duration`, app runs permutation test, writes a markdown report (enriched with `get_actions` recommendations and `list_chats`/`get_chat` evidence), opens a Linear ticket (`Win` / `Loss` / `Inconclusive`), and posts a chart back as a PR comment.
8. Public, shareable result page at `/r/{slug}` (no auth) with `#BuiltWithPeec` watermark + OG card. Dashboard at `/experiments` shows sparklines per active experiment + cumulative pp gained YTD.

---

## 2. High-Level Architecture

```
                      ┌────────────────────────────────────────────┐
                      │       Vercel Hobby (one repo, 2 projects)  │
                      │                                            │
   Browser ──HTTPS──▶ │  apps/web   (Next.js 16, RSC + Cache)      │
                      │     │                                      │
                      │     │ fetch (server actions / RSC)         │
                      │     ▼                                      │
                      │  apps/api  (NestJS, Express adapter,       │
                      │            serverless-http on Vercel Fns)  │
                      │     │                                      │
                      │     ├── Vercel Cron (DAILY only on Hobby)  │
                      │     ├── Vercel Workflow (60s steps each)   │
                      │     └── Webhook routes (GitHub, Vercel)    │
                      └─────┬──────────────────────────────────────┘
                            │
              ┌─────────────┼──────────────────────────┐
              ▼             ▼                          ▼
        Neon Postgres   Peec MCP            GitHub / Vercel / Linear MCP
        (Marketplace)   (HTTP + SSE,        (called from NestJS services)
                         all 27 tools)
```

Why two Vercel projects, not one?
- Keeps Next.js cold starts lean (no NestJS in the same bundle).
- Independent deploys and env scopes.
- API project owns crons; web project owns user traffic.
- Both consume the same Neon DB via shared `@repo/database` package.
- Hobby allows unlimited personal projects, so two is free.

---

## 3. Repo Layout (Turborepo + pnpm)

```
peec-experiment-lab/
├── apps/
│   ├── web/                    # Next.js 16 (App Router, Cache Components)
│   ├── api/                    # NestJS 11
│   └── cli/                    # `npx peec-lab` for non-Cursor MCP hosts (Claude/n8n)
├── packages/
│   ├── database/               # Prisma schema + generated client + migrations
│   ├── shared/                 # Zod schemas, DTOs, enums, pp/lift math types
│   ├── mcp-clients/            # Typed wrappers around all 27 Peec MCP tools + GitHub/Vercel/Linear
│   └── ui/                     # shadcn/ui re-exports + chart primitives
├── examples/
│   └── experiment-templates/   # Public template repo of `experiment.yaml` files (Community Impact)
├── turbo.json
├── pnpm-workspace.yaml
└── vercel.json                 # rewrites for /api → api project (optional)
```

---

## 4. Database Schema (Postgres via Prisma)

Multi-tenant from day one. Every row except `User` has `organization_id`.

```prisma
model Organization {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  members     Membership[]
  experiments Experiment[]
  integrations Integration[]
  peecProjects PeecProject[]
  createdAt   DateTime @default(now())
}

model User {
  id        String       @id @default(cuid())
  email     String       @unique
  name      String?
  memberships Membership[]
}

model Membership {
  id             String       @id @default(cuid())
  userId         String
  organizationId String
  role           Role         // OWNER | ADMIN | MEMBER
  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@unique([userId, organizationId])
}

model Integration {
  id             String   @id @default(cuid())
  organizationId String
  type           IntegrationType  // PEEC | GITHUB | VERCEL | LINEAR
  // KMS-encrypted blob (envelope encryption with AES-GCM data key)
  credentialsCiphertext Bytes
  credentialsIv         Bytes
  credentialsTag        Bytes
  config         Json     // e.g. { repo: "acme/site", defaultBranch: "main" }
  status         IntegrationStatus  // ACTIVE | NEEDS_REAUTH | DISABLED
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@unique([organizationId, type])
}

model PeecProject {
  id             String   @id @default(cuid())
  organizationId String
  peecProjectId  String   // upstream Peec id (from list_projects)
  name           String
  cachedPromptCount Int
  cachedBrandCount  Int
  cachedModels      String[]    // from list_models
  cachedTopics      Json        // from list_topics
  cachedTags        Json        // from list_tags
  lastSyncedAt   DateTime?
  experiments    Experiment[]
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@unique([organizationId, peecProjectId])
}

model Experiment {
  id              String        @id @default(cuid())
  organizationId  String
  peecProjectId   String
  name            String
  hypothesis      String
  status          ExperimentStatus  // DRAFT | SCHEDULED | RUNNING | ANALYZING | WIN | LOSS | INCONCLUSIVE | CANCELLED | ERRORED
  treatmentUrl    String
  treatmentUrlSnapshotBefore String?  // markdown from get_url_content at baseline
  treatmentUrlSnapshotAfter  String?  // markdown from get_url_content at launch+1d
  treatmentPromptIds String[]      // Peec prompt ids
  controlPromptIds   String[]
  engineIds       String[]          // empty = all engines on the project (resolved via list_models)
  peecTopicId     String?           // created via create_topic for clean Peec UI grouping
  peecTagId       String?           // created via create_tag for cohort filtering
  minLiftPp       Float             // user-declared minimum detectable effect (e.g. 5.0 = 5pp)
  durationDays    Int               // computed by power analysis, default 14
  launchAt        DateTime?         // stamped by Vercel deploy webhook
  endsAt          DateTime?         // launchAt + durationDays
  githubPrUrl     String?
  githubPrSha     String?           // re-baseline if this changes
  vercelDeploymentId String?
  randomSeed      Int               // for reproducible permutation tests
  shareSlug       String   @unique  // for public /r/{slug} page
  isPublic        Boolean  @default(false)
  createdById     String
  createdAt       DateTime  @default(now())
  snapshots       ExperimentSnapshot[]
  result          ExperimentResult?
  events          ExperimentEvent[]
  organization    Organization @relation(fields: [organizationId], references: [id])
  peecProject     PeecProject  @relation(fields: [peecProjectId], references: [id])
  @@index([organizationId, status])
}

model ExperimentSnapshot {
  id           String   @id @default(cuid())
  experimentId String
  capturedAt   DateTime
  kind         SnapshotKind  // BASELINE | DAILY | FINAL
  // Per (promptId, engineId) metrics from get_brand_report
  brandMetrics Json     // { promptId: { engineId: { visibility, sov, citationRate, sentiment, position } } }
  // Per-URL metrics from get_url_report (treatment URL + competitor URLs)
  urlMetrics   Json
  // Per-domain metrics from get_domain_report
  domainMetrics Json
  experiment   Experiment @relation(fields: [experimentId], references: [id])
  @@index([experimentId, capturedAt])
}

model ExperimentResult {
  id              String   @id @default(cuid())
  experimentId    String   @unique
  computedAt      DateTime @default(now())
  liftByEngine    Json     // { engineId: { lift_pp, ci_low, ci_high, p_value } }
  competitorMovement Json  // { brandId: { sov_delta, citation_delta } } from list_brands cross-ref
  recommendations Json     // raw payload from get_actions
  evidenceChats   Json     // top chat ids + summaries from list_chats + get_chat
  overallPValue   Float
  verdict         Verdict  // WIN | LOSS | INCONCLUSIVE
  reportMarkdown  String   @db.Text
  reportImageUrl  String?  // OG image stored in Vercel Blob
  experiment      Experiment @relation(fields: [experimentId], references: [id])
}

model ExperimentEvent {
  id           String   @id @default(cuid())
  experimentId String
  type         EventType  // CREATED | POWER_ANALYZED | BASELINE_CAPTURED | LAUNCHED | SNAPSHOTTED | RESULT_COMPUTED | LINEAR_TICKET_CREATED | PR_COMMENTED | PEEC_TOPIC_CREATED | PEEC_TAG_CREATED | ERROR
  payload      Json
  createdAt    DateTime @default(now())
  experiment   Experiment @relation(fields: [experimentId], references: [id])
  @@index([experimentId, createdAt])
}

model WebhookLog {
  id        String   @id @default(cuid())
  source    String   // github | vercel
  headers   Json
  body      Json
  signature String?
  receivedAt DateTime @default(now())
  processedAt DateTime?
  error     String?
}
```

Indexes worth noting:
- `Experiment(organizationId, status)` for the dashboard list query.
- `ExperimentSnapshot(experimentId, capturedAt)` for time-series rendering.
- `WebhookLog(receivedAt)` partial index where `processedAt is null` for the redrive job.

---

## 5. Backend (NestJS) — Module-by-Module

NestJS deployed via **Vercel's zero-configuration NestJS support** (Fluid Compute, native — `serverless-http` is no longer needed as of Vercel's 2026 changelog). Bootstrap is cached across warm invocations, which matters on Hobby's lower-priority cold starts.

### 5.1 Modules

> **Scope note:** this build is a single-tenant demo. The Peec PAT lives in
> `.env`, the demo org is seeded as `acme`, and the web reads the org id via a
> trusted `x-peec-lab-org` header set by the lib data layer. Production-grade
> auth (Clerk JWTs, multi-tenant invites, KMS-encrypted per-org credentials)
> is intentionally out of scope and tracked separately.

| Module | Responsibility |
|---|---|
| `PeecModule` | `PeecMcpService` — typed wrappers over **all 27 Peec MCP tools** (see §5.4 for the coverage matrix) |
| `ExperimentsModule` | CRUD; state machine; YAML parser; references PowerAnalysis; auto-creates Peec topic + tag per experiment |
| `SnapshotsModule` | `SnapshotService.captureFor(experimentId, kind)` — calls `get_brand_report` + `get_url_report` + `get_domain_report` + `get_url_content` |
| `AnalysisModule` | `PowerAnalysisService`, `PermutationTestService`, `ReportBuilderService` (the report builder calls `get_actions`, `list_chats`, `get_chat` to enrich the verdict) |
| `WebhooksModule` | `/webhooks/github`, `/webhooks/vercel` — verifies signatures, enqueues work |
| `JobsModule` | Cron handlers; exposes HTTP endpoints invoked by Vercel Cron (Bearer auth) |
| `WorkflowsModule` | Vercel Workflow definitions for multi-step durable jobs (capture → analyze → notify) |
| `NotificationsModule` | `LinearMcpService.createIssue(...)`, `GitHubMcpService.commentOnPr(...)` |
| `PublicModule` | Unauthenticated routes for `/r/{slug}` shareable result pages |
| `HealthModule` | `/healthz`, `/readyz` |

### 5.2 Public API (selected)

All under `/v1`, JSON. The org id is read from a trusted `x-peec-lab-org`
header (set by the web's lib data layer). `/v1/public/*` is unauthenticated.

```
GET    /v1/peec-projects                    # list_projects
POST   /v1/peec-projects/:id/sync           # refresh prompt/brand/topic/tag/model cache

# Resource pickers used by the create-experiment wizard
GET    /v1/peec/:projectId/prompts          # list_prompts
GET    /v1/peec/:projectId/brands           # list_brands
GET    /v1/peec/:projectId/topics           # list_topics
GET    /v1/peec/:projectId/tags             # list_tags
GET    /v1/peec/:projectId/models           # list_models
GET    /v1/peec/:projectId/search-queries   # list_search_queries (for ghost-prompt suggestions)
GET    /v1/peec/:projectId/shopping-queries # list_shopping_queries (for ecommerce templates)
POST   /v1/peec/:projectId/brands           # create_brand (add untracked competitor)
POST   /v1/peec/:projectId/prompts          # create_prompt (auto-create control prompts)

GET    /v1/experiments?status=&peecProjectId=
POST   /v1/experiments                       # manual create (without GitHub)
GET    /v1/experiments/:id
PATCH  /v1/experiments/:id                   # only DRAFT
POST   /v1/experiments/:id/cancel            # also calls delete_topic + delete_tag for cleanup
POST   /v1/experiments/:id/power-analysis    # idempotent recompute
POST   /v1/experiments/:id/baseline          # force re-baseline
POST   /v1/experiments/:id/refresh-now       # user-triggered Peec refresh (bypass once-daily cron)
POST   /v1/experiments/:id/share             # toggles isPublic
GET    /v1/experiments/:id/snapshots
GET    /v1/experiments/:id/result

GET    /v1/dashboard/summary                 # cumulative pp, win-rate, active count

# Public — no auth (Community Impact)
GET    /v1/public/r/:slug                    # shareable result
GET    /v1/public/leaderboard                # opt-in YTD biggest lifts

# Internal — invoked by Vercel Cron (Bearer = CRON_SECRET)
POST   /v1/internal/cron/daily-snapshots
POST   /v1/internal/cron/finalize-due-experiments

# Webhooks
POST   /v1/webhooks/github
POST   /v1/webhooks/vercel
```

### 5.3 The state machine

```
DRAFT ──(yaml parsed + power analysis ok + topic/tag created in Peec)──▶ SCHEDULED
SCHEDULED ──(vercel deploy webhook fires)──▶ RUNNING  (launchAt stamped, get_url_content snapshot taken)
RUNNING ──(daily cron, no-op if not due)──▶ RUNNING
RUNNING ──(now ≥ endsAt)──▶ ANALYZING
ANALYZING ──(permutation test done, get_actions + chats fetched)──▶ WIN | LOSS | INCONCLUSIVE
* ──(user cancels — also calls delete_topic + delete_tag)──▶ CANCELLED
* ──(unrecoverable error after 3 retries)──▶ ERRORED
```

State transitions only happen inside `ExperimentsService.transition(id, from, to, payload)` which writes an `ExperimentEvent` in the same DB transaction. No other code path mutates `status`.

### 5.4 Peec MCP tool coverage matrix (`packages/mcp-clients`)

We expose typed wrappers around **all 27 Peec MCP tools**, used as follows:

| # | Tool | Where it's used in the app |
|---|---|---|
| 1 | `list_projects` | `/integrations` project picker; org-onboarding |
| 2 | `list_models` | Engine multi-select on `/experiments/new`; resolves `engineIds: []` to "all engines" |
| 3 | `list_brands` | Brand picker; result page "competitor movement" enrichment |
| 4 | `list_topics` | Topic filter in dashboard; auto-suggest topic for ghost prompts |
| 5 | `list_tags` | Tag filter in dashboard; cohort filtering |
| 6 | `list_prompts` | Treatment + control prompt picker |
| 7 | `list_search_queries` | Prompt-frequency weighting in stats; ghost-prompt suggestions for control set |
| 8 | `list_shopping_queries` | Ecommerce experiment template; "comparison page" experiments |
| 9 | `list_chats` | Citation forensics — find chats where visibility moved during experiment |
| 10 | `get_chat` | "Show evidence" drawer on each engine bar; pulls inline citations |
| 11 | `get_brand_report` | **Core metric source.** Baseline (last_30d), daily (last_1d), final (experiment window) |
| 12 | `get_domain_report` | Result page "competitor domain shifts" panel |
| 13 | `get_url_report` | Per-URL citation tracking for treatment URL + top competitor URLs |
| 14 | `get_url_content` | Snapshot the treatment URL **before launch** and **launch+1d** — proves the change actually shipped, powers the "what changed" diff in the report |
| 15 | `get_actions` | "Recommended next steps" section in the result report — Peec speaks for itself |
| 16 | `create_brand` | User adds an untracked competitor inline during experiment setup |
| 17 | `create_prompt` | Auto-create control prompts from ghost queries when user lacks enough |
| 18 | `create_topic` | One per experiment: `experiment:{slug}` — gives every experiment a clean grouping inside Peec's own UI (flywheel for Peec) |
| 19 | `create_tag` | One per experiment cohort, applied to all involved prompts |
| 20–27 | `update_brand`/`prompt`/`topic`/`tag`, `delete_brand`/`prompt`/`topic`/`tag` | Lifecycle: rename topic when experiment renamed; delete tag/topic on experiment cancel; cleanup on org disconnect |

Every wrapper is:
- Validated input (Zod) → MCP `callTool` → validated output (Zod) → typed result.
- Retry policy: 3× exponential, jitter, only on idempotent reads.
- Per-org rate limiting via Redis (Upstash) token bucket — Peec has fan-out limits.
- Telemetry: every call emits an `MCP_CALL` span (OpenTelemetry → Vercel Otel).

### 5.5 Statistical engine

`PermutationTestService.run(experimentId)`:
1. Load all snapshots for the experiment.
2. Build per-prompt time series of `visibility` from `brandMetrics` (the primary metric; SoV and citation_rate are secondaries).
3. For each `(promptId, engineId)` cell, compute `lift = mean(post-launch) - mean(pre-launch)`.
4. Aggregate to per-engine lift weighted by prompt prior frequency from `list_search_queries`.
5. **Permutation test**: 10,000 random reassignments of treatment/control labels; p-value = fraction of permutations with `|lift| ≥ |observed|`. Use `randomSeed` from the experiment row for reproducibility.
6. Bonferroni-correct across engines.
7. Verdict rule:
   - **WIN** if any engine has corrected p < 0.05 AND lift ≥ `minLiftPp`, AND no engine has corrected p < 0.05 with lift ≤ `-minLiftPp`.
   - **LOSS** if any engine corrected p < 0.05 AND lift ≤ `-minLiftPp` AND no winning engines.
   - **INCONCLUSIVE** otherwise.

Pure-TypeScript implementation, zero deps. 10k permutations × ~14 data points × ~3 engines runs in well under 1s, comfortably inside the Hobby 60s function ceiling.

`PowerAnalysisService.estimate(experimentId)`:
- Pull last 30d variance per prompt from baseline snapshots.
- Monte Carlo: simulate the experiment under H1 (true effect = `minLiftPp`) and H0; compute power.
- Recommend `durationDays` to hit 80% power, capped at 28.
- If even at the cap power < 0.6 → return a *block* (the API returns 422 and the PR comment is a warning, not a green check).

`ReportBuilderService.build(experimentId)`:
- Composes the markdown verdict from: permutation result + `get_actions` recommendations + top 3 evidence chats from `list_chats`/`get_chat` + competitor movement from `list_brands` + `get_domain_report` + a before/after diff from the two `get_url_content` snapshots.

### 5.6 Cron & durable jobs (designed for Vercel Hobby)

- **Vercel Cron** (defined in `apps/api/vercel.json`) — built around the **Hobby plan's once-per-day cron limit**:
  - `0 6 * * *` → `POST /v1/internal/cron/daily-snapshots`
  - `0 7 * * *` → `POST /v1/internal/cron/finalize-due-experiments`
- Each cron handler must return well under **60s** (the Hobby per-invocation default ceiling). It does almost no work itself: enumerate due experiments, enqueue one Vercel Workflow per experiment, return.
- **Vercel Workflow** (`@vercel/workflow`) for `captureSnapshotWorkflow` and `finalizeExperimentWorkflow`. Each step runs as its own function invocation with its own 60s budget, automatically checkpointed and retried — this is how we stay safely inside the Hobby per-invocation limit while still doing multi-step work (Peec call → DB write → Linear call → PR comment). Workflow on Hobby includes 50k events/mo + 1 GB data, comfortably enough for ~100+ active experiments per month.
- **No sub-daily polling** anywhere in the system. Freshness comes from (a) webhooks (instant — GitHub PR opened/merged, Vercel deploy succeeded) and (b) a manual “Refresh now” button on the experiment detail page that calls Peec on demand via `POST /v1/experiments/:id/refresh-now`.

### 5.7 Webhooks

- **GitHub** `/v1/webhooks/github`: verify HMAC signature with the per-integration secret. Handle:
  - `pull_request.opened|synchronize` with label `geo-experiment` → parse `experiment.yaml` from the PR head, upsert `Experiment` (status `DRAFT`), kick off power analysis, **call `create_topic` and `create_tag`**, comment on PR.
  - `pull_request.closed{merged: true}` → mark experiment `SCHEDULED` (waiting for Vercel deploy).
- **Vercel** `/v1/webhooks/vercel`: verify signature. On `deployment.succeeded` for `production`:
  - Match by repo + commit SHA → set `launchAt = now()`, `vercelDeploymentId`, transition to `RUNNING`, **call `get_url_content` to snapshot the live treatment URL**, schedule baseline-recompute if SHA changed.

### 5.8 Security (single-tenant demo)

- HMAC verification on every webhook (GitHub `sha256`, Vercel `sha1`).
- Cron endpoints behind `Authorization: Bearer ${CRON_SECRET}`.
- Public `/r/{slug}` pages strip all org/user PII; only experiments with
  `isPublic = true` are reachable.
- `.env` and `.env.local` are gitignored; the only secrets in this build are
  `DATABASE_URL`, `PEEC_MCP_TOKEN`, `GITHUB_TOKEN`, `LINEAR_API_KEY`, and
  webhook secrets — all read at process boot.
- Multi-tenant + Clerk JWT + KMS envelope encryption are explicitly **out of
  scope** for this submission and tracked separately.

---

## 6. Frontend (Next.js 16, App Router)

Cache Components ON. Server Components by default. Server Actions for mutations. shadcn/ui + Tailwind + Recharts for charts.

### 6.1 Routes

```
/                                           # marketing landing + “Connect Peec” CTA
/(app)/dashboard                            # KPIs + active experiments + cumulative pp
/(app)/experiments                          # filterable list
/(app)/experiments/new                      # manual create wizard (uses list_prompts/brands/models/topics/tags pickers)
/(app)/experiments/[id]                     # detail: timeline, sparklines, raw metrics
/(app)/experiments/[id]/result              # final report (markdown + chart + get_actions recommendations)
/(app)/integrations                         # Peec / GitHub / Vercel / Linear connect cards (env-key based)
/r/[slug]                                   # PUBLIC shareable result page (Community Impact)
/leaderboard                                # PUBLIC YTD biggest lifts (across all isPublic experiments)
/api/og/r/[slug]                            # OG image for the public share page
```

### 6.2 Component inventory

- `ExperimentStatusPill` — colored chip per `ExperimentStatus`.
- `LiftSparkline` — small per-engine sparkline; uses Recharts.
- `EngineLiftBarChart` — final result chart with confidence intervals.
- `PowerAnalysisCard` — “At your settings, you'll detect ≥5pp with 82% power in 14 days.”
- `ExperimentTimeline` — horizontal timeline of `ExperimentEvent`s.
- `IntegrationCard` — connect/disconnect/needs-reauth states.
- `MarkdownReport` — `react-markdown` with code blocks for the YAML.
- `CumulativeLiftChart` — YTD pp gained across all WIN experiments.
- `EmptyState` — used wherever data hasn't arrived yet (Peec 24h latency).
- `RefreshNowButton` — calls `/v1/experiments/:id/refresh-now`; visible because cron is once-daily.
- `BeforeAfterDiff` — side-by-side diff of the two `get_url_content` snapshots.
- `RecommendationsPanel` — renders the `get_actions` payload.
- `EvidenceDrawer` — opens chats from `list_chats` + `get_chat` for a given engine bar.
- `CompetitorMovementTable` — “who moved up/down during this experiment” from `list_brands` + `get_domain_report`.
- `ShareButton` — toggles `isPublic`; copies `/r/{slug}` link + tweets with `#BuiltWithPeec`.
- `LeaderboardEntry` — used on `/leaderboard`.

### 6.3 Data fetching pattern

- **Reads**: Server Components call the NestJS API with the user's Clerk JWT forwarded server-side. Wrap in `'use cache'` with `cacheTag('experiment:' + id)` and `cacheLife('minutes')`. Webhook handlers in NestJS call back into Next.js via `revalidateTag` over a signed internal endpoint to bust caches when an experiment transitions.
- **Mutations**: Server Actions that POST to NestJS, then `revalidateTag` the affected experiment.
- **Streaming**: detail page streams the metrics chart in a `<Suspense>` while the timeline renders instantly.
- **Public pages**: `'use cache'` with `cacheLife('hours')` — these are immutable per slug.

### 6.4 UX details that matter

- Power analysis warning is a hard *block* on the create form, not a soft tooltip.
- Show Peec's 24h latency *explicitly* on the detail page (“Day 0 baseline finalizes at 06:00 UTC tomorrow”).
- Show our cron schedule explicitly too (“Auto-snapshot at 06:00 UTC. Need it now? Click Refresh.”) so users understand why fresh numbers might lag.
- “Show evidence” drawer on each engine bar — opens the underlying chats from `list_chats` + `get_chat`.
- Cumulative pp counter on `/dashboard` is the dopamine hit; it's the “number marketing leaders screenshot.”
- Every WIN result page surfaces a one-click "Share with #BuiltWithPeec" CTA → opens X/LinkedIn pre-filled with the OG image and a link to `/r/{slug}`.

---

## 7. Deployment on Vercel

- **Two Vercel projects**, both linked to the same GitHub repo:
  - `peec-lab-web` → root `apps/web`, build = `pnpm turbo run build --filter=web`.
  - `peec-lab-api` → root `apps/api`, build = `pnpm turbo run build --filter=api`. Uses **Vercel's zero-configuration NestJS support** (Fluid Compute, native) — no manual serverless adapter needed.
- **Database**: Neon Postgres provisioned via Vercel Marketplace → auto-injects `DATABASE_URL` to both projects. (Free tier: 0.5 GB storage, 191 compute hours/month — plenty for hackathon scale.)
- **KV/Redis**: Upstash Redis from Marketplace → rate limiting + idempotency keys. (Free tier: 10k commands/day.)
- **Blob**: Vercel Blob for OG images and exported reports. (Hobby has limited free quota; we keep blobs small and prune monthly.)
- **Cron**: configured in `apps/api/vercel.json`. **Hobby = once per day, hourly precision.** Both crons in this app run daily by design.
- **Workflow**: Vercel Workflow DevKit for durable multi-step jobs. Hobby includes 50k events/mo + 1 GB written data.
- **Env scoping**: Production / Preview / Development. Each Preview deploy gets its own Neon branch (Marketplace feature) so PR previews don't pollute prod data.
- **Custom domains**: optional on Hobby (subdomains of `*.vercel.app` are free). For demo, `peec-lab-web.vercel.app` + `peec-lab-api.vercel.app` is fine.
- **Observability**: Vercel native logs + Sentry free tier; structured logs include `experimentId` + `organizationId` on every line.

### 7.1 Vercel Hobby — explicit constraints we design around

| Constraint | Hobby limit | How the plan respects it |
|---|---|---|
| Cron frequency | **Once per day max** (hourly precision) | All polling is daily. Real-time updates come from webhooks (instant) and a user-triggered “Refresh now” button. |
| Cron count | 100 per project | We use 2. |
| Function max duration | **60s default** (300s configurable cap) | Cron handlers fan out and return in <5s. Permutation test runs in <1s. Long flows are split via Vercel Workflow steps, each with its own 60s budget. |
| Function memory | 2 GB / 1 vCPU | Plenty for our workloads. |
| Workflow events | 50k/mo + 1 GB data | ~420 events per experiment → ~119 experiments/month free. |
| Bandwidth | 100 GB/mo | Demo-scale, fine. |
| Edge requests | 1M/mo | Fine. |
| Marketplace integrations (Neon, Upstash, Blob) | Available | Used as planned. |
| Number of projects | Effectively unlimited for personal | Two-project layout is free. |
| Team collaboration | Personal account only (no Team) | Single-developer build is fine for hackathon. |
| **Commercial use** | **Not allowed** | OK for hackathon submission and personal portfolio. **If this ever becomes a paid product or is run on behalf of a company, you must upgrade to Pro.** |

### 7.2 What would change if/when you upgrade to Pro

If this graduates beyond the hackathon, Pro unlocks the natural next steps without re-architecting:
- **Sub-daily cron** → tighten snapshot cadence to hourly during active experiments for faster feedback.
- **Function duration up to 800s** with Fluid Compute → lets us inline the permutation test into a single function if we want to drop Workflow.
- **Team accounts** → multi-developer collaboration, audit logs, SSO.
- **Larger Workflow / Blob / bandwidth quotas** → scale to hundreds of concurrent experiments.

The architecture is forward-compatible: no Hobby compromise locks us out of any of these.

---

## 8. Implementation Roadmap — **4-day sprint to April 26 deadline**

Today is April 22. The Peec MCP Challenge submission window closes **April 26**. We have ~4 working days. The roadmap below ruthlessly cuts to the demoable core; everything past Phase 4 is post-submission polish.

### Day 1 (Apr 23) — Foundation + read-only Peec
- Turborepo + pnpm + Prisma; Neon Postgres + Upstash provisioned via Vercel Marketplace.
- Two Vercel projects (`web`, `api`) deployed as empty shells with healthchecks.
- Clerk auth on web; JWT verification on api.
- `packages/mcp-clients/peec` — typed wrappers for **all 15 read tools** (Zod-in/Zod-out).
- `/integrations` page with Peec PAT input; `list_projects` powers project picker.

### Day 2 (Apr 24) — Experiment loop + snapshots
- Prisma schema fully migrated.
- `POST /v1/experiments` (manual create, no GitHub yet) using the resource pickers.
- `SnapshotService.captureFor(...)` calls `get_brand_report` + `get_url_report` + `get_domain_report` + `get_url_content` and persists.
- `POST /v1/experiments/:id/baseline` + `POST /v1/experiments/:id/refresh-now`.
- Vercel Cron `/v1/internal/cron/daily-snapshots` enqueuing Vercel Workflow.
- `/experiments/new` wizard + `/experiments/[id]` read-only with `LiftSparkline`.

### Day 3 (Apr 25) — Stats + report + Peec writes
- `PowerAnalysisService` (gates the create form) + `PermutationTestService` + `ReportBuilderService`.
- Wire **all 12 Peec write tools**: `create_topic` + `create_tag` on experiment creation; `create_brand` / `create_prompt` from the wizard; `delete_*` on cancel; `update_*` on rename.
- Result page `/experiments/[id]/result` with `EngineLiftBarChart`, `RecommendationsPanel` (from `get_actions`), `BeforeAfterDiff`, `EvidenceDrawer`, `CompetitorMovementTable`.
- GitHub PR comment + Linear ticket creation on verdict.
- Webhooks: GitHub (`pull_request`) and Vercel (`deployment.succeeded`).

### Day 4 (Apr 26) — Community Impact + ship
- **Public share surface**: `/r/{slug}` page (no auth), OG image route with `#BuiltWithPeec` watermark, one-click X/LinkedIn share.
- **Public template repo** (`examples/experiment-templates`): 5 ready-to-fork `experiment.yaml` templates (SaaS, ecommerce, B2B services, dev tools, agency) — each one a separate GitHub-ready template repo.
- **`npx peec-lab`** CLI in `apps/cli` so judges can run a quick experiment from inside Claude Desktop or Cursor without spinning up the full app — uses the same `packages/mcp-clients/peec` wrappers.
- Demo seed: one fake project with one running and one completed experiment so the demo is instant.
- 90-second Loom: PR opened → power analysis comment → mock launch → verdict ticket → public share page.
- Submit Tally form before midnight UTC.

### Post-deadline (Apr 27+)
- `/leaderboard` page with opt-in YTD biggest lifts.
- Sub-daily snapshots once on Pro.
- Multi-tenant invites / billing / SSO.

---

## 9. `experiment.yaml` Schema (the user-facing artifact)

```yaml
id: best-crm-rewrite-2026-04
name: "Rewrite /best-crm-for-startups with FAQ + comparison table"
hypothesis: "Adding an FAQ block + comparison table will lift visibility on Perplexity by 5pp."
treatment_url: https://example.com/best-crm-for-startups
treatment_prompts:
  - prompt_id: peec_pr_a1b2c3
  - prompt_id: peec_pr_d4e5f6
control_prompts:
  - prompt_id: peec_pr_g7h8i9
  - prompt_id: peec_pr_j0k1l2
engines: [perplexity, chatgpt, gemini]   # optional, defaults to all on the project (resolved via list_models)
min_lift_pp: 5
duration_days: auto                       # power-analysis decides
share: public                             # opt into /r/{slug} + #BuiltWithPeec sharing
```

Validated by `experimentYamlSchema` in `packages/shared`. Same schema is used by the API to validate manual creates.

---

## 10. Peec MCP Challenge — judging criteria self-scorecard

| Criterion | Weight | How this plan scores |
|---|---|---|
| Usefulness | 40% | Closes the biggest workflow gap in GEO: causal attribution of content changes to AI visibility. Repeatable per PR, templated for SaaS / ecom / B2B / agencies. |
| Creativity | 30% | "Experiments as code" is novel; permutation test + power analysis are unusual rigor for marketing tooling; auto-creating Peec topics/tags per experiment is a flywheel for Peec itself. |
| Execution Quality | 20% | Statistically defensible (permutation test, Bonferroni, power analysis), reproducible (random seed), durable (Vercel Workflow), well-typed (Zod everywhere), all 27 Peec MCP tools wrapped. |
| Community Impact | 10% | Public `/r/{slug}` pages, OG card with `#BuiltWithPeec` watermark, public template repo, `npx` CLI for non-Cursor MCP hosts, opt-in leaderboard, open-source GitHub Action template. |

---

## 11. Decisions made

This is a single-tenant demo for the MCP Challenge submission. Everything below
is locked in:

- **Auth** — none. Single seeded org `acme`, header-based scoping. Multi-tenant
  + Clerk + KMS encryption are explicitly out of scope.
- **GitHub integration** — single-repo PAT (`GITHUB_TOKEN` env). GitHub App is
  the production follow-up.
- **Stats** — plain TypeScript permutation test (no deps). 10k iterations,
  Bonferroni-corrected.
- **Charting** — Recharts (RSC-compatible via `'use client'` boundaries).
- **Background jobs** — Vercel Cron + inline work in NestJS (well under the
  60s ceiling for typical workloads). Vercel Workflow is the production
  follow-up if we need durable multi-step jobs.
