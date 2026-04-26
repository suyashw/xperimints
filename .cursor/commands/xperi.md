# /xperi — Xperimints experiment lab

You are working inside the **Xperimints** repo (peec-experiment-lab). The user
just invoked `/xperi` to drive an AI-visibility experiment from chat. You have
the **`xperi` MCP server** wired up via `.cursor/mcp.json` — it exposes the
following tools (all prefixed `xperi_`):

**Lifecycle**
- `xperi_list_experiments` — list experiments (filter by status)
- `xperi_get_experiment` — full detail (events, snapshots, result)
- `xperi_create_experiment` — create from structured fields
- `xperi_create_experiment_from_yaml` — create from a raw `experiment.yaml`
- `xperi_cancel_experiment` — cancel from any non-terminal status
- `xperi_refresh_now` — force a fresh DAILY snapshot

**Peec lookups (resource pickers)**
- `xperi_list_peec_projects` — get the *internal* PeecProject id you need for create
- `xperi_list_prompts` — `{ id, text }` for picking treatment + control prompt ids
- `xperi_peec_status` — confirm Peec OAuth is live
- `xperi_sync_peec` — refresh local cache

**Offline (no API needed)**
- `xperi_validate_yaml` — lint an `experiment.yaml`
- `xperi_power_analysis` — quick power sweep (durations × engines × prompts)
- `xperi_dashboard_summary` — running count, win count, cumulative pp YTD

## How to handle the user's request

1. **Read the user's intent below.** If it's exploratory ("show my running
   experiments", "what's my dashboard look like?"), call the relevant read
   tool and summarize the result in 1–3 sentences. Always include experiment
   ids so the user can ask follow-ups.

2. **If they want to *create* an experiment from a free-form prompt**, follow
   this flow without asking confirmation between every step:
   1. `xperi_peec_status` → bail early with an actionable message if disconnected.
   2. `xperi_list_peec_projects` → pick the most-recently-synced one (or the
      one matching the project the user named).
   3. `xperi_list_prompts` for that project → pick prompt ids that fit the
      hypothesis. Split into 2 treatment + 2 control by default; never
      overlap. If <4 prompts are cached, surface that and stop.
   4. Run `xperi_power_analysis` with the chosen `min_lift_pp` (default 5)
      and prompt count to recommend `duration_days`. If even 28 days doesn't
      hit 80% power, warn the user and stop.
   5. `xperi_create_experiment` with the resolved fields. Default
      `isPublic: false`, `randomSeed: 42`. The API auto-creates a Peec topic
      + tag and returns the experiment row.
   6. Reply with a one-line summary: id, slug, recommended duration, power.

3. **If they pass a YAML blob or a path to one**, prefer
   `xperi_create_experiment_from_yaml` — but you still need to resolve the
   internal `peecProjectId` via `xperi_list_peec_projects` because YAML
   doesn't encode that.

4. **If the API call fails** (e.g. NestJS not running), say so plainly and
   suggest `pnpm dev` from the repo root. Read tools (Prisma-backed)
   continue to work even when the API is down.

5. **Never** mutate state by writing Prisma directly or calling raw Peec
   tools — always go through the `xperi_*` tools so the state machine and
   ExperimentEvent audit trail stay authoritative.

6. **Surface ids verbatim** in your reply. Users need them to drill in via
   `/experiments/{id}` in the web app.

## User prompt

$ARGUMENTS
