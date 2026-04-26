import ReactMarkdown from 'react-markdown';

/**
 * MarkdownReport — renders the verdict markdown with reasonable typography.
 * No external CSS framework; everything is local Tailwind utilities.
 */
export function MarkdownReport({ markdown }: { markdown: string }) {
  return (
    <div className="prose-sm max-w-none text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-[color:var(--color-accent)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-[color:var(--color-muted)] [&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:border-[color:var(--color-border)] [&_th]:py-1 [&_th]:px-2 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-[color:var(--color-muted)] [&_td]:border-b [&_td]:border-[color:var(--color-border)]/40 [&_td]:py-1 [&_td]:px-2 [&_code]:rounded [&_code]:bg-[color:var(--color-border)]/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:rounded [&_pre]:bg-[color:var(--color-border)]/40 [&_pre]:p-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_a]:underline [&_a]:text-[color:var(--color-accent)] [&_hr]:my-4 [&_hr]:border-[color:var(--color-border)]">
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </div>
  );
}
