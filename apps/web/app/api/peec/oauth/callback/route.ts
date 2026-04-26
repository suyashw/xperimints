import { type NextRequest } from 'next/server';

const API = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

/**
 * OAuth callback. Forwards `code` and `state` to the API which exchanges
 * them for an access token, stores it in-memory, and triggers a sync.
 *
 * Returns an HTML page rather than a redirect so the callback works even
 * when it lands in a popup or a different tab opened by an SSO provider:
 *
 *   - If we have a `window.opener`, postMessage the result to it and close
 *     the window. The opener (the modal) catches the message and refreshes.
 *   - Otherwise (full-page redirect path), navigate to `/dashboard` with the
 *     same query-string contract we used before.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');
  const origin = req.nextUrl.origin;

  if (errorParam) {
    return htmlResponse(buildResultPage({ origin, ok: false, error: errorParam }));
  }
  if (!code || !state) {
    return htmlResponse(
      buildResultPage({ origin, ok: false, error: 'missing_code_or_state' }),
    );
  }

  try {
    const r = await fetch(`${API}/v1/peec/oauth/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return htmlResponse(
        buildResultPage({
          origin,
          ok: false,
          error: text.slice(0, 200) || r.statusText,
        }),
      );
    }
    return htmlResponse(buildResultPage({ origin, ok: true }));
  } catch (err) {
    return htmlResponse(
      buildResultPage({ origin, ok: false, error: (err as Error).message }),
    );
  }
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

interface PageOpts {
  origin: string;
  ok: boolean;
  error?: string;
}

function buildResultPage({ origin, ok, error }: PageOpts): string {
  const payload = ok
    ? { type: 'peec_auth_success' as const }
    : { type: 'peec_auth_error' as const, error: error ?? 'unknown_error' };
  const successRedirect = `${origin}/dashboard?peec_auth=success`;
  const errorRedirect = `${origin}/dashboard?peec_auth_error=${encodeURIComponent(error ?? 'unknown_error')}`;
  const fallback = ok ? successRedirect : errorRedirect;
  // The `targetOrigin` is intentionally restrictive — we only ever send to
  // ourselves. Stringified once because we inline it into <script>.
  const payloadJson = JSON.stringify(payload);
  const originJson = JSON.stringify(origin);
  const fallbackJson = JSON.stringify(fallback);
  const title = ok ? 'Connected to Peec' : 'Peec connection failed';
  const message = ok
    ? 'You can close this window — Xperimints is finishing the handshake in the background.'
    : `Peec returned an error: ${escapeHtml(error ?? 'unknown_error')}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: oklch(99% 0 0);
        color: oklch(15% 0.01 270);
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        padding: 24px;
      }
      .card {
        max-width: 420px;
        text-align: center;
        border: 1px solid oklch(92% 0.005 270);
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      }
      h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
      p { font-size: 14px; color: oklch(58% 0.01 270); margin: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${message}</p>
    </div>
    <script>
      (function () {
        var payload = ${payloadJson};
        var origin = ${originJson};
        var fallback = ${fallbackJson};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, origin);
            window.close();
            return;
          }
        } catch (_) {}
        // No opener (full-page redirect) — fall back to navigating the dashboard.
        window.location.replace(fallback);
      })();
    </script>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
