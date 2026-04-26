'use client';

import { useState } from 'react';
import { SHARE_INTENT_TEMPLATE, WATERMARK_TEXT } from '@peec-lab/ui';

/**
 * ShareButton — for the (app) detail page. Three actions:
 *  - copy the public /r/{slug} link to clipboard
 *  - tweet a pre-filled #BuiltWithPeec post
 *  - share on LinkedIn
 *
 * The dropdown is intentionally simple: a `<details>` element so we don't
 * need a popover library. Closes when the user clicks outside via the
 * native `<details>` toggle behaviour.
 */
export function ShareButton({
  shareUrl,
  verdictLine,
  isPublic,
}: {
  shareUrl: string;
  verdictLine: string;
  isPublic: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (!isPublic) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-[color:var(--color-border)] px-2.5 py-1 text-xs text-[color:var(--color-muted)]">
        Public sharing off
      </span>
    );
  }

  const tweetHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    SHARE_INTENT_TEMPLATE(shareUrl, verdictLine),
  )}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    shareUrl,
  )}`;

  return (
    <details className="relative">
      <summary className="list-none inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-accent)] px-2.5 py-1 text-xs font-medium text-[color:var(--color-accent-fg)] cursor-pointer">
        Share {WATERMARK_TEXT}
      </summary>
      <div className="absolute right-0 mt-1 z-20 w-56 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] shadow-lg p-1 text-sm">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore — older browsers
            }
          }}
          className="block w-full text-left px-2 py-1.5 rounded hover:bg-[color:var(--color-border)]/40"
        >
          {copied ? '✓ Link copied' : 'Copy link'}
        </button>
        <a
          href={tweetHref}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-2 py-1.5 rounded hover:bg-[color:var(--color-border)]/40"
        >
          Share on X
        </a>
        <a
          href={linkedinHref}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-2 py-1.5 rounded hover:bg-[color:var(--color-border)]/40"
        >
          Share on LinkedIn
        </a>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-2 py-1.5 rounded hover:bg-[color:var(--color-border)]/40 text-[color:var(--color-muted)]"
        >
          Open public page →
        </a>
      </div>
    </details>
  );
}
