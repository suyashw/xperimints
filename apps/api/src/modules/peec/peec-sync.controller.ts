import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from '@nestjs/common';
import { decodeRows } from '@peec-lab/mcp-clients';
import { PeecMcpService } from './peec-mcp.service.js';
import { PeecSyncService } from './peec-sync.service.js';

const ORG_HEADER = 'x-peec-lab-org';

interface SyncBody {
  /**
   * Optional. When set, the sync targets this Peec project id instead
   * of the first row returned by `list_projects`. Used by the
   * onboarding picker so the user can pin the project before any
   * data lands in the local cache.
   */
  peecProjectId?: string;
}

@Controller('peec')
export class PeecSyncController {
  constructor(
    private readonly peec: PeecMcpService,
    private readonly sync: PeecSyncService,
  ) {}

  /**
   * Connection status. Sourced entirely from the `Integration` table so it
   * agrees with the integrations card on every render — no in-memory mode
   * field to drift after API restarts.
   *
   * The `x-peec-lab-org` header is optional: when present we scope the
   * lookup to that org so a per-user dashboard pill stays honest, when
   * absent we fall back to "any active PEEC integration anywhere"
   * (matches the legacy behaviour for cron/system probes).
   */
  @Get('status')
  async status(@Headers(ORG_HEADER) organizationId: string | undefined) {
    const live = await this.peec.isConnected(organizationId || undefined);
    return {
      mode: live ? 'live' : 'disconnected',
      baseUrl: this.peec.baseUrl,
    };
  }

  /**
   * Live `list_projects` lookup against the org's connected Peec
   * workspace. Backs the onboarding project-picker step so the user
   * can choose which project to attach Xperimints to before any
   * `PeecProject` row is written locally.
   *
   * Stays read-only: no DB writes, no caching — the source of truth is
   * Peec, and the answer changes as users add/archive projects there.
   */
  @Get('projects')
  async listProjects(@Headers(ORG_HEADER) organizationId: string) {
    if (!organizationId) {
      throw new BadRequestException(`Missing ${ORG_HEADER} header`);
    }
    const client = await this.peec.getClient(organizationId);
    if (!client) {
      return {
        ok: false as const,
        error:
          'Peec MCP is not connected for this workspace. Connect it from the integrations page first.',
      };
    }
    try {
      const resp = await client.listProjects({ include_inactive: false });
      const rows = decodeRows<{
        id: string;
        name: string;
        status?: string;
      }>(resp);
      return {
        ok: true as const,
        projects: rows.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status ?? null,
        })),
      };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  }

  /**
   * The single Peec-fetch entry point — backs the dashboard's "Refresh from
   * Peec" button and the onboarding "Connect Peec" → sync step. The caller
   * may pass `peecProjectId` in the body to pin the sync to a specific
   * upstream project; otherwise the service falls back to the first row
   * returned by `list_projects`. On failure we persist the error onto
   * the cached PeecProject row so the next dashboard render shows a
   * "Sync failed" pill instead of silently re-rendering stale data.
   */
  @Post('sync')
  async sync_(
    @Headers(ORG_HEADER) organizationId: string,
    @Body() body: SyncBody | undefined,
  ) {
    if (!organizationId) {
      throw new BadRequestException(`Missing ${ORG_HEADER} header`);
    }
    if (!(await this.peec.isConnected(organizationId))) {
      return {
        ok: false as const,
        error: 'Peec MCP is not connected. Connect it from the integrations page first.',
      };
    }
    try {
      const result = await this.sync.syncForOrg(organizationId, {
        ...(body?.peecProjectId
          ? { preferredPeecProjectId: body.peecProjectId }
          : {}),
      });
      return { ok: true as const, ...result };
    } catch (err) {
      const msg = (err as Error).message;
      await this.sync.recordSyncError(organizationId, msg).catch(() => {
        // intentionally swallowed — recording the error is best-effort and
        // must not mask the original failure on the response
      });
      return { ok: false as const, error: msg };
    }
  }
}
