import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentOrg } from '@/lib/data';

const API = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

/**
 * Kicks off the Peec OAuth flow. Reads the signed-in user's org from
 * the session cookie and forwards it to the API alongside the
 * callback URL so the API knows which org to persist the resulting
 * Integration row against.
 *
 * On the happy path we redirect the popup straight to Peec's
 * authorization endpoint. On any failure (anonymous caller, API
 * unreachable, API rejected the request) we render an HTML page that
 * `postMessage`s the error back to `window.opener` and self-closes —
 * the same shape `/api/peec/oauth/callback` uses on its failure
 * branch — so the parent (integrations card or onboarding flow)
 * surfaces a real error instead of the popup silently navigating to
 * /dashboard and getting bounced through our auth gates.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/peec/oauth/callback`;

  const org = await getCurrentOrg();
  if (!org) {
    return failurePage(origin, 'Not signed in. Reload and try again.');
  }

  try {
    const r = await fetch(`${API}/v1/peec/oauth/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirectUri, organizationId: org.id }),
      cache: 'no-store',
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return failurePage(origin, `Peec API ${r.status}: ${text.slice(0, 200)}`);
    }
    const { authUrl } = (await r.json()) as { authUrl: string };
    return NextResponse.redirect(authUrl);
  } catch (err) {
    const msg = (err as Error).message;
    const friendly =
      msg === 'fetch failed'
        ? 'Could not reach the Xperimints API at ' +
          API +
          '. Make sure the API server is running (pnpm dev) and try again.'
        : msg;
    return failurePage(origin, friendly);
  }
}

function failurePage(origin: string, error: string): Response {
  const payload = { type: 'peec_auth_error' as const, error };
  const fallback = `${origin}/onboarding?peec_auth_error=${encodeURIComponent(error)}`;
  const payloadJson = JSON.stringify(payload);
  const originJson = JSON.stringify(origin);
  const fallbackJson = JSON.stringify(fallback);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Peec connection failed</title>
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
        max-width: 460px;
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
      <h1>Peec connection failed</h1>
      <p>${escapeHtml(error)}</p>
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
        window.location.replace(fallback);
      })();
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
