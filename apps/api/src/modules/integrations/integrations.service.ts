import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  type Integration,
  type PrismaClient,
} from '@peec-lab/database';
import { PRISMA } from '../../prisma/prisma.module.js';
import { decryptJson, encryptJson } from './credential-crypto.js';

interface IntegrationCardView {
  type: IntegrationType;
  status: IntegrationStatus | 'NOT_CONNECTED';
  connectedAt: string | null;
  updatedAt: string | null;
  /** Connection account/identity surface (e.g. "@octocat", "demo@team.com"). */
  account: string | null;
  config: Record<string, unknown>;
}

interface ConnectRequest {
  type: IntegrationType;
  /**
   * Raw secret material. Shape depends on `type`:
   *   - GITHUB / VERCEL / LINEAR / PEEC → `{ token: string, ...optional }`
   */
  credentials: Record<string, string>;
  /** Non-secret config (e.g. `{ repo: "acme/site" }`). */
  config?: Record<string, unknown>;
}

interface ConnectionProbeResult {
  ok: boolean;
  account: string | null;
  error?: string;
  /** Auth-issued token captured from the upstream (e.g. installation token). */
  refreshedToken?: string;
}

type DecryptedCredentials = Record<string, string | undefined>;

const CARD_TYPES: IntegrationType[] = [
  IntegrationType.PEEC,
  IntegrationType.GITHUB,
  IntegrationType.VERCEL,
  IntegrationType.LINEAR,
];

/**
 * Owns the lifecycle of per-org integration credentials.
 *
 * Responsibilities:
 *   1. List the four supported integrations with their connection state.
 *   2. Probe a candidate credential against the upstream API. We only persist
 *      a row when the probe succeeds — that way the UI never shows ACTIVE for
 *      a token that doesn't actually work.
 *   3. Encrypt credentials with AES-256-GCM (envelope-friendly schema) before
 *      writing to Postgres, and decrypt on read.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(organizationId: string): Promise<IntegrationCardView[]> {
    const rows = await this.prisma.integration.findMany({ where: { organizationId } });
    const byType = new Map<IntegrationType, Integration>();
    for (const r of rows) byType.set(r.type, r);

    return CARD_TYPES.map((type) => this.toCardView(type, byType.get(type)));
  }

  async connect(organizationId: string, req: ConnectRequest): Promise<IntegrationCardView> {
    if (!req.credentials || typeof req.credentials !== 'object') {
      throw new Error('credentials object is required');
    }
    const probe = await this.probe(req.type, req.credentials);
    if (!probe.ok) {
      throw new Error(probe.error ?? 'connection probe failed');
    }
    const finalCreds: DecryptedCredentials = {
      ...req.credentials,
      ...(probe.refreshedToken ? { token: probe.refreshedToken } : {}),
    };
    const sealed = encryptJson(finalCreds);
    const config = {
      ...(req.config ?? {}),
      account: probe.account,
      lastVerifiedAt: new Date().toISOString(),
    };
    const saved = await this.prisma.integration.upsert({
      where: { organizationId_type: { organizationId, type: req.type } },
      create: {
        organizationId,
        type: req.type,
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
      `Connected ${req.type} for org ${organizationId} (account=${probe.account ?? 'unknown'}).`,
    );
    return this.toCardView(req.type, saved);
  }

  async disconnect(organizationId: string, type: IntegrationType): Promise<void> {
    await this.prisma.integration.deleteMany({ where: { organizationId, type } });
    this.logger.log(`Disconnected ${type} for org ${organizationId}.`);
  }

  /**
   * Re-test the stored credentials and update status accordingly. Returns the
   * latest card view. If decryption fails we surface NEEDS_REAUTH so the UI
   * prompts the user to re-enter the secret.
   */
  async test(organizationId: string, type: IntegrationType): Promise<IntegrationCardView> {
    const row = await this.prisma.integration.findUnique({
      where: { organizationId_type: { organizationId, type } },
    });
    if (!row) {
      throw new Error(`${type} is not connected`);
    }
    let creds: DecryptedCredentials;
    try {
      creds = decryptJson<DecryptedCredentials>({
        ciphertext: Buffer.from(row.credentialsCiphertext),
        iv: Buffer.from(row.credentialsIv),
        tag: Buffer.from(row.credentialsTag),
      });
    } catch (err) {
      this.logger.warn(
        `Decrypt failed for ${type}/${organizationId}: ${(err as Error).message}`,
      );
      const updated = await this.prisma.integration.update({
        where: { id: row.id },
        data: { status: IntegrationStatus.NEEDS_REAUTH },
      });
      return this.toCardView(type, updated);
    }

    const probe = await this.probe(type, creds);
    const updated = await this.prisma.integration.update({
      where: { id: row.id },
      data: {
        status: probe.ok ? IntegrationStatus.ACTIVE : IntegrationStatus.NEEDS_REAUTH,
        config: {
          ...((row.config as Record<string, unknown>) ?? {}),
          account: probe.account,
          lastVerifiedAt: new Date().toISOString(),
          lastError: probe.ok ? null : (probe.error ?? null),
        },
      },
    });
    return this.toCardView(type, updated);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Connection probes
  // ──────────────────────────────────────────────────────────────────────

  private async probe(
    type: IntegrationType,
    credentials: Record<string, string | undefined>,
  ): Promise<ConnectionProbeResult> {
    const token = (credentials.token ?? '').trim();
    if (!token) {
      return { ok: false, account: null, error: 'token is required' };
    }
    try {
      switch (type) {
        case IntegrationType.GITHUB:
          return await probeGitHub(token);
        case IntegrationType.VERCEL:
          return await probeVercel(token);
        case IntegrationType.LINEAR:
          return await probeLinear(token);
        case IntegrationType.PEEC:
          return await probePeec(token);
        default:
          return { ok: false, account: null, error: `unsupported integration: ${type}` };
      }
    } catch (err) {
      return { ok: false, account: null, error: (err as Error).message };
    }
  }

  private toCardView(type: IntegrationType, row?: Integration | null): IntegrationCardView {
    if (!row) {
      return {
        type,
        status: 'NOT_CONNECTED',
        connectedAt: null,
        updatedAt: null,
        account: null,
        config: {},
      };
    }
    const cfg = (row.config as Record<string, unknown>) ?? {};
    return {
      type,
      status: row.status,
      connectedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      account: typeof cfg.account === 'string' ? cfg.account : null,
      config: cfg,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Per-provider probe implementations (kept module-private — this file is
// the only place we know how to authenticate against each upstream).
// ──────────────────────────────────────────────────────────────────────

async function probeGitHub(token: string): Promise<ConnectionProbeResult> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'peec-experiment-lab',
    },
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, account: null, error: `GitHub rejected the token (${res.status})` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, account: null, error: `GitHub /user ${res.status}: ${body.slice(0, 200)}` };
  }
  const json = (await res.json()) as { login?: string; email?: string | null };
  return { ok: true, account: json.login ?? json.email ?? null };
}

async function probeVercel(token: string): Promise<ConnectionProbeResult> {
  const res = await fetch('https://api.vercel.com/v2/user', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, account: null, error: `Vercel rejected the token (${res.status})` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, account: null, error: `Vercel /v2/user ${res.status}: ${body.slice(0, 200)}` };
  }
  const json = (await res.json()) as { user?: { username?: string; email?: string } };
  return {
    ok: true,
    account: json.user?.username ?? json.user?.email ?? null,
  };
}

async function probeLinear(token: string): Promise<ConnectionProbeResult> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id email name } }' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      account: null,
      error: `Linear graphql ${res.status}: ${body.slice(0, 200)}`,
    };
  }
  const json = (await res.json()) as {
    data?: { viewer?: { email?: string; name?: string } };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    return {
      ok: false,
      account: null,
      error: json.errors.map((e) => e.message).join('; '),
    };
  }
  if (!json.data?.viewer) {
    return { ok: false, account: null, error: 'Linear returned no viewer' };
  }
  return {
    ok: true,
    account: json.data.viewer.email ?? json.data.viewer.name ?? null,
  };
}

/**
 * Peec MCP token probe — issues a `tools/list` JSON-RPC call against the
 * Streamable HTTP endpoint. A 200 + non-error payload proves the token is
 * authoritative for this Peec workspace.
 */
async function probePeec(token: string): Promise<ConnectionProbeResult> {
  const baseUrl = process.env.PEEC_MCP_BASE_URL ?? 'https://api.peec.ai/mcp';
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, account: null, error: `Peec MCP rejected the token (${res.status})` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      account: null,
      error: `Peec MCP ${res.status}: ${body.slice(0, 200)}`,
    };
  }
  return { ok: true, account: 'peec-workspace' };
}
