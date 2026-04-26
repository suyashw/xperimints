import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Xperimints',
  description:
    'Treat marketing content like code: hypothesis → PR → deployment → measured lift → verdict.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Browser extensions (ColorZilla, Grammarly, LastPass, Dark Reader, etc.)
  // routinely inject attributes onto <body> *before* React hydrates — e.g.
  // ColorZilla adds `cz-shortcut-listen="true"`. That makes the client tree
  // diverge from the server-rendered HTML and triggers a hydration warning we
  // can't fix in our code. `suppressHydrationWarning` only silences the
  // attribute/text comparison on this single element (not descendants), so
  // it's the canonical React-recommended fix for this exact case.
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
