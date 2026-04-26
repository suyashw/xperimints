import type { PeecTransport } from './transport.js';

export interface HttpTransportOptions {
  baseUrl: string;
  /** Peec PAT, sent as Bearer. */
  token: string;
  fetchImpl?: typeof fetch;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
  /**
   * Invoked once whenever the upstream returns 401 (token expired or revoked).
   * Use it to drop the cached token + flip the UI back to the connect-modal
   * state so the user can re-authenticate.
   */
  onAuthExpired?: () => void;
}

/**
 * HTTP+SSE transport for Peec MCP. We POST tool invocations as JSON-RPC over
 * the standard MCP HTTP endpoint. The protocol surface that Peec exposes is
 * documented at https://docs.peec.ai/mcp.
 *
 * For the hackathon we use the simple JSON-over-HTTP path — no SSE streaming
 * required since none of the 27 Peec tools stream their responses.
 *
 * Single-attempt by design: every tool call hits Peec exactly once. The
 * dashboard explicitly opted out of automatic retries / auto-syncs so that
 * an upstream Peec failure surfaces immediately as an "Sync failed" pill
 * the user can react to (instead of being silently masked by background
 * retries that burn quota and delay the response).
 *
 * If you need to swap in the official @modelcontextprotocol/sdk Streamable
 * HTTP client later, just change this file — the rest of the app talks
 * exclusively through the PeecTransport interface.
 */
export class HttpPeecTransport implements PeecTransport {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly onAuthExpired?: () => void;

  constructor(opts: HttpTransportOptions) {
    if (!opts.token) throw new Error('HttpPeecTransport: token is required');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.onAuthExpired = opts.onAuthExpired;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // baseUrl already points at the JSON-RPC endpoint (e.g. https://api.peec.ai/mcp).
      // Peec's Streamable HTTP transport returns 406 unless we accept BOTH
      // `application/json` and `text/event-stream` — even when the response
      // ends up being plain JSON. We handle both content types below.
      const res = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: cryptoRandomId(),
          method: 'tools/call',
          params: { name, arguments: args },
        }),
        signal: controller.signal,
      });
      if (res.status === 401) {
        const text = await res.text().catch(() => '');
        this.onAuthExpired?.();
        throw new Error(`Peec MCP HTTP 401 (auth expired): ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        // Peec's MCP returns HTTP 500 with an OAuth-shaped error envelope
        // (e.g. {"error":"server_error","error_description":"Internal Server Error"})
        // when the bearer is expired or revoked, instead of a clean 401.
        // Detect that envelope and treat it the same as 401 so the
        // integration row flips to NEEDS_REAUTH and the dashboard pill is
        // honest. Genuine Peec server errors don't ship this exact shape.
        const text = await res.text().catch(() => '');
        if (looksLikeAuthErrorEnvelope(text)) {
          this.onAuthExpired?.();
          throw new Error(
            `Peec MCP HTTP ${res.status} (auth-error envelope): ${text.slice(0, 200)}`,
          );
        }
        throw new Error(`Peec MCP HTTP ${res.status}: ${text.slice(0, 500)}`);
      }
      const json = await readJsonRpcResponse(res);
      if (json.error) throw new Error(`Peec MCP error: ${json.error.message}`);
      return extractResult(json.result);
    } finally {
      clearTimeout(timer);
    }
  }
}

interface JsonRpcEnvelope {
  result?: { content?: Array<{ type: string; text?: string; json?: unknown }> };
  error?: { message: string };
}

/**
 * Peec may respond with either `application/json` (a single envelope) or
 * `text/event-stream` (one `data:` event carrying the same envelope). Both
 * shapes carry the same JSON-RPC response — just parse whichever arrived.
 */
async function readJsonRpcResponse(res: Response): Promise<JsonRpcEnvelope> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream')) {
    const body = await res.text();
    // Event lines start with `data:` — accumulate them, then JSON-parse.
    const dataLines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    if (dataLines.length === 0) {
      throw new Error(`Peec MCP SSE response had no data event: ${body.slice(0, 300)}`);
    }
    const merged = dataLines.join('');
    try {
      return JSON.parse(merged) as JsonRpcEnvelope;
    } catch (err) {
      throw new Error(
        `Peec MCP SSE data was not valid JSON (${(err as Error).message}): ${merged.slice(0, 300)}`,
      );
    }
  }
  return (await res.json()) as JsonRpcEnvelope;
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * RFC 6749 §5.2 error codes that an OAuth resource server may return when
 * the bearer is bad. Peec MCP also (incorrectly) ships `server_error` with
 * a 500 status for expired bearers — we treat that as auth-expired too,
 * which is conservative (the worst case is a transient real 500 also
 * flipping NEEDS_REAUTH; the user reconnects once and we move on).
 */
const AUTH_ERROR_CODES = new Set([
  'invalid_token',
  'invalid_grant',
  'invalid_client',
  'unauthorized',
  'unauthorized_client',
  'access_denied',
  'server_error',
]);

function looksLikeAuthErrorEnvelope(body: string): boolean {
  if (!body) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const code = (parsed as { error?: unknown }).error;
  return typeof code === 'string' && AUTH_ERROR_CODES.has(code);
}

/**
 * MCP responses come back as `result.content[]` of typed parts. For Peec we
 * always get one part — either `json` (preferred) or `text` we have to JSON.parse.
 */
function extractResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return result;
  const first = content[0] as { type?: string; text?: string; json?: unknown };
  if (first?.json !== undefined) return first.json;
  if (typeof first?.text === 'string') {
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
  return first;
}
