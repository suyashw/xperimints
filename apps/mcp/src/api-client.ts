/**
 * Thin HTTP client for the Xperimints NestJS API. Every state-mutating tool
 * (create / cancel / refresh-now) round-trips through here so the API's
 * state machine + ExperimentEvent audit trail stay the single source of
 * truth — the MCP server never reaches around them and writes Prisma
 * directly for mutations.
 *
 * Reads can be served either through here or through Prisma (see
 * `prisma-reads.ts`). For latency we prefer Prisma for read-only
 * dashboard-style queries; for anything that mirrors a real API endpoint
 * (e.g. `cancel`) we always go via HTTP.
 */

import type { Logger } from './logger.js';

interface ApiClientOptions {
  baseUrl: string;
  organizationId: string;
  logger: Logger;
  /**
   * Per-request timeout. The longest API path we call is `refresh-now`
   * which fans out one Peec snapshot capture; well under 60s.
   */
  timeoutMs?: number;
}

class XperiApiError extends Error {
  override readonly cause?: unknown;
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'XperiApiError';
    this.cause = cause;
  }
}

export class XperiApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/v1${path}`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-peec-lab-org': this.opts.organizationId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new XperiApiError(
        `Network error calling ${method} ${path}: ${(err as Error).message}. ` +
          `Is the API running at ${this.opts.baseUrl}? (set XPERI_API_URL to override)`,
        0,
        path,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new XperiApiError(
        `${method} ${path} → ${res.status}: ${text.slice(0, 400)}`,
        res.status,
        path,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
