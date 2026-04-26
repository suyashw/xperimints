#!/usr/bin/env node
/**
 * Xperimints MCP server (`xperi-mcp`).
 *
 * Exposes the experiment lab as a stdio MCP server so any compliant host
 * (Cursor, Claude Desktop, Cline, Continue, n8n's MCP node, etc.) can drive
 * it from chat. The matching slash command for Cursor lives in
 * `.cursor/commands/xperi.md` — typing `/xperi "create an experiment for
 * the new pricing page"` calls into this server's tools.
 *
 * Tool surface (all prefixed `xperi_`):
 *   - Lifecycle  : list / get / create / create_from_yaml / cancel / refresh_now
 *   - Lookups    : list_peec_projects / list_prompts / peec_status / sync_peec
 *   - Offline    : validate_yaml / power_analysis
 *   - Telemetry  : dashboard_summary
 *
 * Reads use Prisma directly (low-latency, works without the API).
 * Mutations round-trip through the NestJS API at `XPERI_API_URL`
 * (default http://localhost:3001) so the state machine + ExperimentEvent
 * audit trail stay authoritative.
 *
 * Env:
 *   XPERI_API_URL  – NestJS base URL (default http://localhost:3001).
 *   XPERI_ORG_ID   – Override the demo org id resolved at startup.
 *   DATABASE_URL   – Required for Prisma reads (same as the rest of the repo).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { XperiApiClient } from './api-client.js';
import { stderrLogger } from './logger.js';
import { resolveOrgId } from './org.js';
import { registerExperimentTools } from './tools/experiments.js';
import { registerOfflineTools } from './tools/offline.js';
import { registerPeecTools } from './tools/peec.js';

const SERVER_NAME = 'xperi';
const SERVER_VERSION = '0.1.0';

async function main(): Promise<void> {
  const apiBase = process.env.XPERI_API_URL ?? 'http://localhost:3001';
  let organizationId: string;
  try {
    organizationId = await resolveOrgId(process.env.XPERI_ORG_ID);
  } catch (err) {
    // No org in the DB yet (fresh install, nobody signed up). The MCP
    // process is started by `pnpm dev` alongside the API + web; we
    // don't want to crash the whole turbo run while the developer is
    // still signing up. Log, sleep forever, and let the process get
    // restarted next time turbo retriggers it.
    const msg = (err as Error).message;
    stderrLogger.warn(
      'xperi MCP idle: no organization yet. Sign up via /signup, then restart this server.',
      { error: msg },
    );
    // Block forever so turbo treats this task as long-running rather
    // than failed. Exiting non-zero would kill `pnpm dev` for the
    // whole monorepo.
    await new Promise<never>(() => {});
    return;
  }
  stderrLogger.info('Starting xperi MCP server', {
    apiBase,
    organizationId,
    version: SERVER_VERSION,
  });

  const api = new XperiApiClient({
    baseUrl: apiBase,
    organizationId,
    logger: stderrLogger,
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      // No resources / prompts yet — only tools.
      capabilities: { tools: {} },
      instructions:
        'You are the Xperimints (xperi) experiment-lab MCP. The user manages ' +
        'AI-visibility A/B experiments wired through Peec MCP. To create an ' +
        'experiment, first call xperi_list_peec_projects to get the internal ' +
        'PeecProject id, then xperi_list_prompts to pick treatment + control ' +
        'prompt ids, then xperi_create_experiment. To inspect, use ' +
        'xperi_list_experiments / xperi_get_experiment / xperi_dashboard_summary. ' +
        'All mutations go through the NestJS API\'s state machine; never ' +
        'attempt to skip statuses by hand.',
    },
  );

  registerExperimentTools(server, { api, organizationId });
  registerPeecTools(server, { api, organizationId });
  registerOfflineTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  stderrLogger.info('xperi MCP server ready on stdio');
}

main().catch((err) => {
  stderrLogger.error('Fatal: xperi MCP server failed to start', {
    error: (err as Error).message,
    stack: (err as Error).stack,
  });
  process.exit(1);
});
