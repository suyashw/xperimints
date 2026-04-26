/**
 * Pure Prisma reads used by MCP tools. We keep these here (rather than
 * delegating to the API) for two reasons:
 *
 *   1. Latency — the MCP server runs locally next to the DB; an extra HTTP
 *      hop just to read a list view costs more than it's worth.
 *   2. Survivability — the MCP can answer read-only questions ("list my
 *      experiments", "what Peec projects are connected?") even when the
 *      NestJS API isn't running. Useful when the user's `pnpm dev` is down
 *      and they still want to inspect state from Cursor.
 *
 * Mutations always go via `XperiApiClient` (see `tools/experiments.ts`)
 * so the state machine stays authoritative.
 */

import { prisma } from '@peec-lab/database';
import type { ExperimentStatus } from '@peec-lab/database';

interface ColumnarPayload {
  columns?: string[];
  rows?: unknown[][];
}

function decodeColumnar<T extends Record<string, unknown>>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object') return [];
  const { columns, rows } = payload as ColumnarPayload;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      out[col] = row[i];
    });
    return out as T;
  });
}

export async function listExperiments(
  organizationId: string,
  filter?: { status?: ExperimentStatus; limit?: number },
) {
  return prisma.experiment.findMany({
    where: {
      organizationId,
      ...(filter?.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter?.limit ?? 50,
    select: {
      id: true,
      name: true,
      hypothesis: true,
      status: true,
      treatmentUrl: true,
      minLiftPp: true,
      durationDays: true,
      launchAt: true,
      endsAt: true,
      shareSlug: true,
      isPublic: true,
      createdAt: true,
      result: {
        select: {
          verdict: true,
          overallPValue: true,
          computedAt: true,
        },
      },
    },
  });
}

export async function getExperimentDetail(organizationId: string, id: string) {
  const exp = await prisma.experiment.findFirst({
    where: { id, organizationId },
    include: {
      result: true,
      snapshots: {
        orderBy: { capturedAt: 'asc' },
        select: {
          id: true,
          kind: true,
          capturedAt: true,
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        select: {
          type: true,
          payload: true,
          createdAt: true,
        },
      },
      peecProject: { select: { id: true, name: true, peecProjectId: true } },
    },
  });
  return exp;
}

export async function listPeecProjects(organizationId: string) {
  return prisma.peecProject.findMany({
    where: { organizationId },
    orderBy: { lastSyncedAt: 'desc' },
    select: {
      id: true,
      peecProjectId: true,
      name: true,
      lastSyncedAt: true,
      lastSyncError: true,
    },
  });
}

interface CachedPrompt {
  id: string;
  text?: string;
}

interface PromptMessage {
  content?: unknown;
}

interface PromptRow extends Record<string, unknown> {
  id?: string;
  text?: string;
  prompt?: string;
  content?: string;
  messages?: PromptMessage[] | string;
}

function extractPromptText(row: PromptRow): string | undefined {
  if (typeof row.text === 'string' && row.text.length > 0) return row.text;
  if (typeof row.prompt === 'string' && row.prompt.length > 0) return row.prompt;
  if (typeof row.content === 'string' && row.content.length > 0) return row.content;
  if (Array.isArray(row.messages)) {
    for (const m of row.messages) {
      if (m && typeof m.content === 'string' && m.content.length > 0) return m.content;
    }
  } else if (typeof row.messages === 'string' && row.messages.length > 0) {
    return row.messages;
  }
  return undefined;
}

/**
 * Lists the cached prompts for the most-recently-synced Peec project of
 * `organizationId` (or the project explicitly named via `peecProjectInternalId`).
 * Returned shape is `{ id, text }` so callers can show humans the actual
 * question, not opaque pr_ cuids.
 */
export async function listCachedPrompts(
  organizationId: string,
  peecProjectInternalId?: string,
  limit = 100,
): Promise<CachedPrompt[]> {
  const project = peecProjectInternalId
    ? await prisma.peecProject.findFirst({
        where: { id: peecProjectInternalId, organizationId },
        select: { cachedPrompts: true },
      })
    : await prisma.peecProject.findFirst({
        where: { organizationId },
        orderBy: { lastSyncedAt: 'desc' },
        select: { cachedPrompts: true },
      });
  if (!project) return [];
  const rows = decodeColumnar<PromptRow>(project.cachedPrompts).slice(0, limit);
  return rows
    .filter((r): r is PromptRow & { id: string } => typeof r.id === 'string')
    .map((r) => ({ id: r.id, text: extractPromptText(r) }));
}

export async function getDashboardSummary(organizationId: string) {
  const [active, completed, all] = await Promise.all([
    prisma.experiment.count({
      where: { organizationId, status: 'RUNNING' },
    }),
    prisma.experiment.count({
      where: { organizationId, status: 'WIN' },
    }),
    prisma.experiment.findMany({
      where: { organizationId, status: 'WIN' },
      select: { result: { select: { liftByEngine: true } } },
    }),
  ]);
  let cumulativePp = 0;
  for (const exp of all) {
    const lifts = (exp.result?.liftByEngine ?? {}) as Record<
      string,
      { lift_pp?: number; p_value_corrected?: number }
    >;
    for (const v of Object.values(lifts)) {
      if ((v.p_value_corrected ?? 1) < 0.05 && (v.lift_pp ?? 0) > 0) {
        cumulativePp += v.lift_pp ?? 0;
      }
    }
  }
  return { activeCount: active, winCount: completed, cumulativePp };
}
