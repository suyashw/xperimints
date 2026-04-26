# peec-lab CLI

A tiny CLI for the [Peec AI MCP Challenge](https://peec.ai/mcp-challenge) — run experiments from the terminal, Claude Desktop, or n8n.

## Install

```bash
npx peec-lab --help
```

## Commands

```bash
peec-lab init                     # write a starter experiment.yaml in cwd
peec-lab validate experiment.yaml # lint against the schema
peec-lab power    experiment.yaml # quick power analysis (offline, no DB)
peec-lab projects                 # list_projects on your Peec account
```

## Auth

Set `PEEC_MCP_TOKEN` in your env to talk to the live Peec MCP server. Without it, the CLI runs in fake mode and returns canned data so you can demo the surface without credentials.

## Why a CLI?

Not every judging panel uses Cursor. With `npx peec-lab`, anyone running Claude Desktop, n8n, or just a plain terminal can validate the experiment.yaml schema, get a power estimate, and exercise the same `@peec-lab/mcp-clients` library that powers the full web app. Drop into Claude with a quick `bash -c "peec-lab init && peec-lab power experiment.yaml"`.
