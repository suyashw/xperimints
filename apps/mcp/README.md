# `@peec-lab/mcp` — Xperimints MCP server

Exposes the Xperimints experiment lab as an [MCP](https://modelcontextprotocol.io)
server so any MCP host (Cursor, Claude Desktop, Cline, Continue, n8n's MCP
node, etc.) can drive it from chat. Companion to the `/xperi` Cursor slash
command at [`.cursor/commands/xperi.md`](../../.cursor/commands/xperi.md).

## Tool surface (`xperi_*`)

| Tool | Purpose |
|---|---|
| `xperi_list_experiments` | List experiments for the demo org (filterable by status). |
| `xperi_get_experiment` | Detail with event timeline, snapshots, result. |
| `xperi_create_experiment` | Create from structured fields (POSTs to NestJS). |
| `xperi_create_experiment_from_yaml` | Same, but from a raw `experiment.yaml` body. |
| `xperi_cancel_experiment` | Cancel from any non-terminal status. |
| `xperi_refresh_now` | Force a fresh DAILY snapshot now. |
| `xperi_list_peec_projects` | Pickers for the create flow — internal + upstream ids. |
| `xperi_list_prompts` | `{ id, text }` for picking treatment + control prompt ids. |
| `xperi_peec_status` | Is the Peec OAuth bearer alive? |
| `xperi_sync_peec` | Refresh the local Peec cache. |
| `xperi_validate_yaml` | Lint `experiment.yaml` against the canonical Zod schema. |
| `xperi_power_analysis` | Pure Monte-Carlo power sweep — picks `duration_days`. |
| `xperi_dashboard_summary` | Active count, win count, cumulative pp YTD. |

### Read vs. mutate split

- **Reads** go through Prisma directly (`prisma-reads.ts`). Same code path as
  `apps/web/lib/data.ts`. Keeps latency low and lets you ask "what
  experiments are running?" even when the API is down.
- **Mutations** round-trip through the NestJS API at `XPERI_API_URL`
  (default `http://localhost:3001`). The API owns the state machine and
  writes one `ExperimentEvent` per transition — the MCP never reaches
  around it.

### Offline tools

`xperi_validate_yaml` and `xperi_power_analysis` are pure transforms over
`@peec-lab/shared` and need neither the DB nor the API.

## Run it

```bash
# 1. Build once (or run watch via tsx)
pnpm --filter @peec-lab/mcp build

# 2. Smoke-test it speaks MCP over stdio
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node --env-file=.env apps/mcp/dist/server.js
```

## Wire it into Cursor

The repo ships with `.cursor/mcp.json` already pointed at this server:

```json
{
  "mcpServers": {
    "xperi": {
      "command": "node",
      "args": ["--env-file=.env", "./apps/mcp/dist/server.js"],
      "env": { "XPERI_API_URL": "http://localhost:3001" }
    }
  }
}
```

After `pnpm install && pnpm --filter @peec-lab/mcp build`, restart Cursor and
you'll see `xperi` light up in the MCP panel. The `/xperi` slash command in
`.cursor/commands/xperi.md` is the friendly entry point — type
`/xperi "create an experiment for the new pricing page"` and the agent will
chain `xperi_*` tools end to end.

## Wire it into Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xperi": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/peec-ai/.env",
        "/absolute/path/to/peec-ai/apps/mcp/dist/server.js"
      ]
    }
  }
}
```

## Environment

| Var | Default | Notes |
|---|---|---|
| `XPERI_API_URL` | `http://localhost:3001` | NestJS base URL — used for mutations. |
| `XPERI_ORG_ID` | _(auto)_ | Override the resolved demo org id. |
| `DATABASE_URL` | _(required)_ | Same Postgres the rest of the repo points at. |

## Why a separate `apps/mcp` and not the existing `apps/cli`?

`apps/cli` is a one-shot `npx peec-lab …` runner — it parses argv, prints to
stdout, exits. The MCP server is a long-lived JSON-RPC duplex on stdio with
a different protocol contract (no stray stdout, structured errors,
`tools/list` discovery). Splitting them keeps each surface focused.
