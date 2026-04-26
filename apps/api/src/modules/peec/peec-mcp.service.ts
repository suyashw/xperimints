import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  type PrismaClient,
} from '@peec-lab/database';
import { HttpPeecTransport, PeecClient } from '@peec-lab/mcp-clients';
import { PRISMA } from '../../prisma/prisma.module.js';
import { decryptJson, encryptJson } from '../integrations/credential-crypto.js';

/**
 * Shape we store inside the encrypted credentials blob. Only `token` is
 * required; the rest are added incrementally as Peec returns them.
 *   - refreshToken / clientId / redirectUri: written by the OAuth callback,
 *     used here to mint `grant_type=refresh_token` requests.
 *   - tokenType: passed through for completeness.
 *
 * Older rows (issued before refresh was wired) won't have refreshToken or
 * clientId — those get a single NEEDS_REAUTH on first expiry, then the
 * reconnect mints a row with the full bundle and refresh works thereafter.
 */
interface PeecCreds {
  token: string;
  refreshToken?: string;
  tokenType?: string;
  clientId?: string;
  redirectUri?: string;
}

interface RefreshTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Single shared Peec client.
 *
 * Source of truth = the Postgres `Integration` row written by the OAuth
 * callback (or the manual Connect form). This service holds NO standalone
 * mode/token state of its own — every status check and every client
 * acquisition goes through `getClient()`, which reads the active Integration
 * row and decrypts its sealed token.
 *
 * For perf, the built `PeecClient` is cached in memory keyed on the row's
 * `updatedAt`: any reconnect or token rotation bumps `updatedAt`, the cache
 * misses, and a fresh client is built on the next call. The cache is also
 * cleared when the upstream returns 401 — at which point the row is flipped
 * to `NEEDS_REAUTH` so the integrations card and the dashboard pill both
 * surface the disconnected state on the next render.
 */
@Injectable()
export class PeecMcpService {
  private readonly logger = new Logger(PeecMcpService.name);
  readonly baseUrl: string;
  private readonly tokenEndpoint: string;
  /**
   * Refresh proactively when the bearer is within this many ms of expiry.
   * Big enough to cover the longest tool call we ever issue (sync ≈ 6s) so
   * we never start a request with a token that dies mid-flight.
   */
  private readonly refreshSkewMs = 60_000;

  /**
   * In-memory client cache. The cache key is the Integration row's
   * `updatedAt.getTime()` — that uniquely identifies a (token, config) pair
   * because every probe / reconnect / re-test touches `updatedAt`.
   */
  private cached: { key: number; client: PeecClient } | null = null;
  /**
   * Single-flight refresh guard. Refresh tokens are single-use, so two
   * concurrent `getClient()` calls landing on the same expired row would
   * race and burn the refresh_token in one of them. Coalesce instead.
   * Keyed by integration id so multi-tenant later-on stays correct.
   */
  private refreshInFlight = new Map<string, Promise<PeecCreds | null>>();

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {
    this.baseUrl = process.env.PEEC_MCP_BASE_URL ?? 'https://api.peec.ai/mcp';
    this.tokenEndpoint =
      process.env.PEEC_OAUTH_TOKEN_ENDPOINT ?? 'https://api.peec.ai/mcp/token';
    // touch: ensures nest --watch reloads after @peec-lab/mcp-clients dist updates
  }

  /**
   * Quick check used by the dashboard pill and the controller status route.
   * Single indexed Postgres SELECT — cheap to call on every page render.
   *
   * When `organizationId` is passed we scope the lookup to that org so a
   * per-user dashboard never shows "Live" because *another* user happens
   * to have Peec connected. Cron / system code that doesn't have an org
   * in scope can call without args (matches the historical behaviour).
   */
  async isConnected(organizationId?: string): Promise<boolean> {
    const row = await this.prisma.integration.findFirst({
      where: {
        type: IntegrationType.PEEC,
        status: IntegrationStatus.ACTIVE,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Build (or reuse) a PeecClient backed by an ACTIVE Integration row.
   * Pass `organizationId` to scope to a single org (the multi-tenant
   * default after the email/password auth flow); omit to fall back to
   * "any active PEEC integration in the DB", which is what the system
   * cron jobs still rely on. Returns `null` when no matching row is
   * found so callers can gracefully degrade (sync becomes a no-op,
   * snapshot capture short-circuits, etc.) without throwing.
   */
  async getClient(organizationId?: string): Promise<PeecClient | null> {
    const row = await this.prisma.integration.findFirst({
      where: {
        type: IntegrationType.PEEC,
        status: IntegrationStatus.ACTIVE,
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) {
      // Drop any stale cache so we don't accidentally return a client whose
      // backing row was just disconnected.
      this.cached = null;
      return null;
    }

    let creds: PeecCreds;
    try {
      creds = decryptJson<PeecCreds>({
        ciphertext: Buffer.from(row.credentialsCiphertext),
        iv: Buffer.from(row.credentialsIv),
        tag: Buffer.from(row.credentialsTag),
      });
    } catch (err) {
      this.logger.error(
        `Could not decrypt PEEC integration row ${row.id}: ${(err as Error).message}. Marking NEEDS_REAUTH.`,
      );
      await this.markNeedsReauth(row.id, 'decrypt-failed');
      this.cached = null;
      return null;
    }

    if (!creds.token) {
      this.logger.warn(`PEEC integration row ${row.id} has no token. Marking NEEDS_REAUTH.`);
      await this.markNeedsReauth(row.id, 'token-missing');
      this.cached = null;
      return null;
    }

    // If the bearer is within `refreshSkewMs` of expiry, swap it for a
    // fresh one before handing the client out. We only attempt refresh
    // when we have everything we need (refresh_token + client_id);
    // otherwise we fall through and let the upstream call surface the
    // expiry as a 401/server_error so the user gets nudged to reconnect.
    const expiresAtMs = readExpiresAtMs(row.config);
    const isNearExpiry =
      expiresAtMs !== null && Date.now() + this.refreshSkewMs >= expiresAtMs;
    if (isNearExpiry && creds.refreshToken && creds.clientId) {
      const refreshed = await this.runRefresh(row.id, creds);
      if (!refreshed) {
        // runRefresh already marked NEEDS_REAUTH on a hard failure.
        this.cached = null;
        return null;
      }
      creds = refreshed;
    } else if (isNearExpiry) {
      this.logger.warn(
        `PEEC integration ${row.id} is at/past expiry but cannot refresh (refreshToken=${Boolean(
          creds.refreshToken,
        )}, clientId=${Boolean(
          creds.clientId,
        )}). The next Peec call will likely fail; user should reconnect.`,
      );
    }

    // Re-read the row so the cache key tracks any update runRefresh just
    // wrote — otherwise the next call would see a stale `updatedAt` and
    // skip the freshly-rotated bundle.
    const finalRow = await this.prisma.integration.findUnique({
      where: { id: row.id },
      select: { updatedAt: true },
    });
    const cacheKey = (finalRow?.updatedAt ?? row.updatedAt).getTime();
    if (this.cached && this.cached.key === cacheKey) {
      return this.cached.client;
    }

    const transport = new HttpPeecTransport({
      baseUrl: this.baseUrl,
      token: creds.token,
      onAuthExpired: () => {
        // Fire-and-forget — invalidates the cache and flips the row so the
        // next page render reflects the disconnected state.
        void this.handleAuthExpired(row.id);
      },
    });
    const client = new PeecClient(transport);
    this.cached = { key: cacheKey, client };
    this.logger.log(`Peec MCP client built from Integration row ${row.id} → ${this.baseUrl}`);
    return client;
  }

  /**
   * Coalesces concurrent refresh attempts on the same Integration row so
   * we don't burn the (single-use) refresh_token twice. The returned
   * promise resolves to the freshly-rotated credentials, or `null` if
   * refresh failed in a way that warrants NEEDS_REAUTH.
   */
  private runRefresh(integrationId: string, creds: PeecCreds): Promise<PeecCreds | null> {
    const existing = this.refreshInFlight.get(integrationId);
    if (existing) return existing;
    const p = this.doRefresh(integrationId, creds).finally(() => {
      this.refreshInFlight.delete(integrationId);
    });
    this.refreshInFlight.set(integrationId, p);
    return p;
  }

  /**
   * Issues `grant_type=refresh_token` against Peec's token endpoint and
   * persists the result. On a 4xx (refresh token revoked / expired) or any
   * unexpected response shape, the row is flipped to NEEDS_REAUTH so the
   * dashboard pill turns red instead of silently failing on every call.
   * Network blips return null without flipping status — the call site
   * will simply try again on the next request.
   */
  private async doRefresh(integrationId: string, creds: PeecCreds): Promise<PeecCreds | null> {
    if (!creds.refreshToken || !creds.clientId) {
      // Caller already gated on these — this branch only exists so the
      // method is safe to call standalone (e.g. from tests).
      return null;
    }
    this.logger.log(`Refreshing PEEC bearer for integration ${integrationId}…`);
    let res: Response;
    try {
      res = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: creds.refreshToken,
          client_id: creds.clientId,
        }),
      });
    } catch (err) {
      // Transient network failure — leave the row ACTIVE; caller will get
      // null and propagate, and the next attempt may succeed.
      this.logger.warn(
        `Refresh transport error for ${integrationId}: ${(err as Error).message}`,
      );
      return null;
    }
    if (res.status === 400 || res.status === 401) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `Refresh rejected (${res.status}) for ${integrationId}: ${body.slice(0, 200)}. Marking NEEDS_REAUTH.`,
      );
      await this.markNeedsReauth(integrationId, `refresh-${res.status}`);
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `Refresh upstream error (${res.status}) for ${integrationId}: ${body.slice(0, 200)}.`,
      );
      return null;
    }
    let json: RefreshTokenResponse;
    try {
      json = (await res.json()) as RefreshTokenResponse;
    } catch (err) {
      this.logger.warn(
        `Refresh response was not JSON for ${integrationId}: ${(err as Error).message}.`,
      );
      return null;
    }
    if (!json.access_token) {
      this.logger.warn(`Refresh response missing access_token for ${integrationId}.`);
      return null;
    }
    // Some IdPs return a new refresh_token, others let you reuse the old
    // one. Prefer the new one when present.
    const newCreds: PeecCreds = {
      ...creds,
      token: json.access_token,
      ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
      ...(json.token_type ? { tokenType: json.token_type } : {}),
    };
    const sealed = encryptJson(newCreds);
    const cfgRaw = await this.prisma.integration
      .findUnique({ where: { id: integrationId }, select: { config: true } })
      .then((r) => (r?.config as Record<string, unknown> | null) ?? {});
    const newConfig: Record<string, unknown> = {
      ...cfgRaw,
      lastVerifiedAt: new Date().toISOString(),
      ...(typeof json.expires_in === 'number'
        ? { expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString() }
        : {}),
    };
    // Drop any prior lastError that referenced the now-rotated bearer.
    delete newConfig.lastError;
    delete newConfig.lastErrorAt;
    await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        credentialsCiphertext: sealed.ciphertext,
        credentialsIv: sealed.iv,
        credentialsTag: sealed.tag,
        // JSON-roundtrip to satisfy Prisma's InputJsonValue constraint
        // (it doesn't accept the looser Record<string, unknown> shape).
        config: JSON.parse(JSON.stringify(newConfig)) as object,
        status: IntegrationStatus.ACTIVE,
      },
    });
    // Invalidate the in-memory client cache so getClient() rebuilds the
    // transport with the rotated bearer.
    this.cached = null;
    this.logger.log(
      `PEEC bearer refreshed for ${integrationId} (expires_in=${json.expires_in ?? 'n/a'}s).`,
    );
    return newCreds;
  }

  /**
   * Throws when there is no ACTIVE PEEC integration. Use this in any code
   * path that cannot meaningfully proceed without live Peec data.
   */
  async requireClient(): Promise<PeecClient> {
    const client = await this.getClient();
    if (!client) {
      throw new Error(
        'Peec MCP is not connected. Open the integrations page and click Connect with OAuth.',
      );
    }
    return client;
  }

  /**
   * Force the next `getClient()` call to re-read from Postgres. Called by
   * the OAuth service immediately after writing a fresh Integration row so
   * subsequent calls don't keep using a stale cached client.
   */
  invalidateCache(): void {
    this.cached = null;
  }

  private async handleAuthExpired(integrationId: string): Promise<void> {
    this.cached = null;
    await this.markNeedsReauth(integrationId, 'upstream-401').catch((err) => {
      this.logger.warn(
        `Could not flip PEEC integration ${integrationId} to NEEDS_REAUTH: ${(err as Error).message}`,
      );
    });
  }

  private async markNeedsReauth(integrationId: string, reason: string): Promise<void> {
    const row = await this.prisma.integration.findUnique({ where: { id: integrationId } });
    if (!row) return;
    const cfg = (row.config as Record<string, unknown>) ?? {};
    await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: IntegrationStatus.NEEDS_REAUTH,
        config: { ...cfg, lastError: `peec-mcp:${reason}`, lastErrorAt: new Date().toISOString() },
      },
    });
    this.logger.warn(`Peec MCP integration ${integrationId} → NEEDS_REAUTH (${reason}).`);
  }
}

/**
 * Read `config.expiresAt` (ISO string written by the OAuth callback) and
 * return it as epoch ms. Returns null when the row doesn't carry an
 * expiry — e.g. legacy rows or any reason the IdP omitted `expires_in`.
 */
function readExpiresAtMs(config: unknown): number | null {
  if (!config || typeof config !== 'object') return null;
  const raw = (config as Record<string, unknown>).expiresAt;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
