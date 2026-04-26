import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IntegrationStatus, IntegrationType, type PrismaClient } from '@peec-lab/database';
import { PRISMA } from '../../prisma/prisma.module.js';
import { encryptJson } from '../integrations/credential-crypto.js';
import { PeecMcpService } from './peec-mcp.service.js';
import { PeecSyncService } from './peec-sync.service.js';

interface PendingFlow {
  verifier: string;
  clientId: string;
  redirectUri: string;
  organizationId: string;
  createdAt: number;
}

interface RegistrationResponse {
  client_id: string;
  client_secret?: string;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * OAuth 2.1 PKCE flow against the Peec MCP authorization server.
 *
 * Flow:
 *   1. UI hits /v1/peec/oauth/start with a redirectUri pointing back at the
 *      web app. We do Dynamic Client Registration once per redirectUri,
 *      cache the resulting client_id on disk so subsequent connects don't
 *      hit Peec's registration rate limit, generate a PKCE pair + state,
 *      stash the verifier in `pending`, and return the authorization URL.
 *   2. Browser walks the user through Peec's login, then redirects to the
 *      web's /api/peec/oauth/callback, which forwards { code, state } to us.
 *   3. We exchange the code for an access token, hand it to PeecMcpService
 *      (in-memory only), and kick off a background sync.
 *
 * The client registration cache is non-secret (PKCE makes the client_id
 * useless without our verifier), but we still gitignore the file.
 */
@Injectable()
export class PeecOAuthService {
  private readonly logger = new Logger(PeecOAuthService.name);
  private readonly pending = new Map<string, PendingFlow>();
  private readonly TTL_MS = 5 * 60 * 1000;
  private readonly clientCachePath = resolve(process.cwd(), '../../.peec-oauth-clients.json');
  private readonly clientCache: Map<string, string> = this.loadClientCache();

  // Endpoints — overridable via env, defaults are the published Peec values.
  // (We pin these explicitly because the discovered metadata advertises the
  // wrong top-level paths; see scripts/peec-auth.ts for the original probe.)
  private readonly authzEndpoint =
    process.env.PEEC_OAUTH_AUTHORIZATION_ENDPOINT ?? 'https://api.peec.ai/mcp/authorize';
  private readonly tokenEndpoint =
    process.env.PEEC_OAUTH_TOKEN_ENDPOINT ?? 'https://api.peec.ai/mcp/token';
  private readonly registrationEndpoint =
    process.env.PEEC_OAUTH_REGISTRATION_ENDPOINT ?? 'https://api.peec.ai/mcp/register';
  private readonly resource = process.env.PEEC_MCP_BASE_URL ?? 'https://api.peec.ai/mcp';
  private readonly scope = 'mcp';

  constructor(
    private readonly peec: PeecMcpService,
    private readonly sync: PeecSyncService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async start(
    redirectUri: string,
    organizationId: string,
  ): Promise<{ authUrl: string; state: string }> {
    if (!redirectUri) throw new Error('redirectUri is required');
    if (!organizationId) throw new Error('organizationId is required');
    // Ensure the org exists before stashing pending state — fail loud
    // here rather than mid-callback when we'd otherwise persist into
    // an org that was just deleted.
    const orgExists = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!orgExists) throw new Error(`organization ${organizationId} not found`);
    this.gc();

    const reg = await this.getOrRegisterClient(redirectUri);
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));

    this.pending.set(state, {
      verifier,
      clientId: reg.client_id,
      redirectUri,
      organizationId,
      createdAt: Date.now(),
    });

    const url = new URL(this.authzEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', reg.client_id);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.scope);
    url.searchParams.set('resource', this.resource);

    this.logger.log(`OAuth start → redirectUri=${redirectUri}, client_id=${reg.client_id}`);
    return { authUrl: url.toString(), state };
  }

  async callback(state: string, code: string): Promise<{ ok: true }> {
    const flow = this.pending.get(state);
    if (!flow) throw new Error('invalid or expired state');
    this.pending.delete(state);

    const tokenResp = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.redirectUri,
        client_id: flow.clientId,
        code_verifier: flow.verifier,
      }),
    });
    if (!tokenResp.ok) {
      const text = await tokenResp.text().catch(() => '');
      throw new Error(`token endpoint ${tokenResp.status}: ${text.slice(0, 300)}`);
    }
    const token = (await tokenResp.json()) as TokenResponse;
    if (!token.access_token) throw new Error('token endpoint returned no access_token');

    // Persist FIRST so the DB (the single source of truth) reflects the new
    // connection before any downstream consumer asks for a client. We pass
    // through clientId + redirectUri so PeecMcpService can later issue
    // refresh_token grants without re-deriving them from the on-disk client
    // cache. Errors are logged but not re-thrown — the callback response
    // stays clean and the next `getClient()` will simply return null until
    // the user retries.
    let persisted = false;
    try {
      await this.persistIntegration(
        flow.organizationId,
        token,
        flow.clientId,
        flow.redirectUri,
      );
      persisted = true;
    } catch (err) {
      this.logger.error(`Persist Peec integration failed: ${(err as Error).message}`);
    }
    // Drop the cached client so the next getClient() call re-reads the
    // freshly-written Integration row.
    if (persisted) this.peec.invalidateCache();
    this.logger.log(
      `Peec MCP authenticated via OAuth (expires_in=${token.expires_in ?? 'n/a'}s) — kicking off sync for org ${flow.organizationId}.`,
    );
    void this.sync.syncForOrg(flow.organizationId).catch((err) => {
      this.logger.error(`Post-OAuth sync failed: ${(err as Error).message}`);
    });
    return { ok: true };
  }

  /**
   * Mirror the freshly-issued OAuth token into the Integration table for
   * the org that started this OAuth flow so /integrations flips to
   * ACTIVE on the next page render. Encrypted at rest with the same
   * AES-256-GCM helper the IntegrationsService uses.
   *
   * The org id is the one the web bridge passed into `start()` and is
   * trustworthy because we never echoed it through the browser — it
   * lives only in the in-memory pending state.
   */
  private async persistIntegration(
    organizationId: string,
    token: TokenResponse,
    clientId: string,
    redirectUri: string,
  ): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true },
    });
    if (!org) {
      this.logger.warn(
        `Organization ${organizationId} disappeared during OAuth flow — skipping persist.`,
      );
      return;
    }
    // clientId/redirectUri travel with the credentials (encrypted at rest)
    // because PeecMcpService needs them to mint a `grant_type=refresh_token`
    // request later, and the on-disk OAuth client cache is keyed by
    // redirectUri only — we wouldn't be able to look up the right entry
    // otherwise.
    const credentials = {
      token: token.access_token,
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      ...(token.token_type ? { tokenType: token.token_type } : {}),
      clientId,
      redirectUri,
    };
    const sealed = encryptJson(credentials);
    const config = {
      account: 'peec-workspace',
      lastVerifiedAt: new Date().toISOString(),
      authMethod: 'oauth',
      ...(typeof token.expires_in === 'number'
        ? { expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() }
        : {}),
    };
    await this.prisma.integration.upsert({
      where: { organizationId_type: { organizationId: org.id, type: IntegrationType.PEEC } },
      create: {
        organizationId: org.id,
        type: IntegrationType.PEEC,
        credentialsCiphertext: sealed.ciphertext,
        credentialsIv: sealed.iv,
        credentialsTag: sealed.tag,
        config,
        status: IntegrationStatus.ACTIVE,
      },
      update: {
        credentialsCiphertext: sealed.ciphertext,
        credentialsIv: sealed.iv,
        credentialsTag: sealed.tag,
        config,
        status: IntegrationStatus.ACTIVE,
      },
    });
    this.logger.log(
      `Persisted PEEC integration for org ${org.slug} (id=${org.id}, encrypted).`,
    );
  }

  /**
   * Cursor-style: register the OAuth client once per redirectUri and reuse
   * the resulting client_id forever. Without this we hit Peec's 429 rate
   * limit on the second connect click.
   */
  private async getOrRegisterClient(redirectUri: string): Promise<RegistrationResponse> {
    // Reload from disk on every call so external changes (manual edits, our
    // poller, cross-process registrations) are picked up without a restart.
    this.refreshClientCacheFromDisk();
    const cached = this.clientCache.get(redirectUri);
    if (cached) {
      this.logger.log(`Reusing cached OAuth client for ${redirectUri} (client_id=${cached}).`);
      return { client_id: cached };
    }
    const reg = await this.registerClient(redirectUri);
    this.clientCache.set(redirectUri, reg.client_id);
    this.persistClientCache();
    this.logger.log(
      `Registered new OAuth client for ${redirectUri} (client_id=${reg.client_id}); cached for reuse.`,
    );
    return reg;
  }

  private refreshClientCacheFromDisk(): void {
    const fresh = this.loadClientCache();
    for (const [k, v] of fresh) this.clientCache.set(k, v);
  }

  private async registerClient(redirectUri: string): Promise<RegistrationResponse> {
    const res = await fetch(this.registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'xperimints',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: this.scope,
      }),
    });
    if (res.status === 429) {
      throw new Error(
        'Peec registration rate-limited (429). Wait a minute and try again — the client_id will be cached after the first success so this only happens once.',
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`registration ${res.status}: ${text.slice(0, 300)}`);
    }
    const reg = (await res.json()) as RegistrationResponse;
    if (!reg.client_id) throw new Error('registration response missing client_id');
    return reg;
  }

  private loadClientCache(): Map<string, string> {
    try {
      const raw = readFileSync(this.clientCachePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  private persistClientCache(): void {
    try {
      const obj = Object.fromEntries(this.clientCache.entries());
      writeFileSync(this.clientCachePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      this.logger.warn(`Could not persist OAuth client cache: ${(err as Error).message}`);
    }
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.createdAt > this.TTL_MS) this.pending.delete(k);
    }
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
