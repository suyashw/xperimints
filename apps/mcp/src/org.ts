import { prisma } from '@peec-lab/database';

/**
 * Resolve the organization the MCP server should operate on behalf of.
 *
 * Resolution order:
 *   1. `XPERI_ORG_ID` env override — explicit and unambiguous, the
 *      preferred path for ops/operators driving multiple workspaces.
 *   2. The oldest organization in the database — the dev-friendly
 *      fallback for the common case where one developer has signed
 *      up via the web app and is now driving the same account from
 *      Cursor / Claude Desktop.
 *
 * Throws when the table is empty: in that case the operator hasn't
 * signed up yet, so there is no org for the MCP to use. The error
 * message points them at the web flow rather than a (now-removed)
 * seed script.
 */
export async function resolveOrgId(envOverride?: string): Promise<string> {
  if (envOverride && envOverride.length > 0) return envOverride;
  const fallback = await prisma.organization.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!fallback) {
    throw new Error(
      'No organization found in the database. Sign up at http://localhost:3000/signup ' +
        'to create one, or set XPERI_ORG_ID to point at an existing org.',
    );
  }
  return fallback.id;
}
