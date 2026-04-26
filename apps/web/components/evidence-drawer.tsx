'use client';

import { useEffect, useState } from 'react';

export interface EvidenceChat {
  chat_id: string;
  model_id: string;
  prompt_id?: string;
  prompt_text?: string;
  summary?: string;
  link?: string;
  citations?: Array<{ url: string; domain?: string; title?: string }>;
}

/**
 * EvidenceDrawer — slides over from the right and lists the top chats from
 * `list_chats` + `get_chat` for a given engine. Shows the prompt, response
 * summary, and inline citations with their domain.
 *
 * Lightweight: no shadcn Sheet dependency — pure Tailwind + a portal-free
 * fixed positioning. Closes on Escape and on backdrop click.
 */
export function EvidenceDrawer({
  open,
  onClose,
  engine,
  chats,
}: {
  open: boolean;
  onClose: () => void;
  engine: string | null;
  chats: ReadonlyArray<EvidenceChat>;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Evidence">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-[color:var(--color-bg)] shadow-xl border-l border-[color:var(--color-border)] flex flex-col">
        <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-5 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
              Evidence chats
            </p>
            <p className="font-medium">
              {engine ? <code className="text-sm">{engine}</code> : 'All engines'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs hover:border-[color:var(--color-accent)]"
            aria-label="Close evidence drawer"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {chats.length === 0 && (
            <p className="text-sm text-[color:var(--color-muted)] italic">
              No chats found yet. list_chats may still be warming up for this experiment window.
            </p>
          )}
          {chats.map((c) => (
            <article
              key={c.chat_id}
              className="rounded-md border border-[color:var(--color-border)] p-3"
            >
              <div className="flex items-baseline gap-2">
                <code className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)]">
                  {c.model_id}
                </code>
                <code className="text-[10px] text-[color:var(--color-muted)]">{c.chat_id}</code>
              </div>
              {c.prompt_text && (
                <p className="text-sm mt-2">
                  <span className="text-[color:var(--color-muted)]">Prompt:</span>{' '}
                  <span className="font-medium">{c.prompt_text}</span>
                </p>
              )}
              {c.summary && (
                <p className="text-sm mt-2 text-[color:var(--color-muted)] italic">
                  {c.summary}
                </p>
              )}
              {c.citations && c.citations.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">
                  {c.citations.slice(0, 6).map((cite, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-[color:var(--color-muted)] tabular-nums">
                        [{i + 1}]
                      </span>
                      <a
                        href={cite.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline truncate"
                      >
                        {cite.title || cite.domain || cite.url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {c.link && (
                <a
                  href={c.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline mt-2 inline-block"
                >
                  Open chat in Peec →
                </a>
              )}
            </article>
          ))}
          <p className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted)] pt-2">
            Source: <code>list_chats</code> + <code>get_chat</code>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Tiny convenience hook so callers don't need to manage open/close themselves.
 */
export function useEvidenceDrawerState() {
  const [open, setOpen] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);
  return {
    open,
    engine,
    show: (e: string | null = null) => {
      setEngine(e);
      setOpen(true);
    },
    close: () => setOpen(false),
  };
}
