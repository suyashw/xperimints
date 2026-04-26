import { listIntegrationsAction } from '@/app/actions/integrations';
import { IntegrationCard } from '@/components/integration-card';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const result = await listIntegrationsAction();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Connect Peec, GitHub, Vercel, and Linear to power the experiment loop.
          Tokens are verified against each provider on save and stored
          AES-256-GCM encrypted at rest.
        </p>
      </header>

      {!result.ok && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Could not load integrations: {result.error}
        </div>
      )}

      {result.ok && (
        <section className="grid gap-4 sm:grid-cols-2">
          {result.data.map((card) => (
            <IntegrationCard key={card.type} initial={card} />
          ))}
        </section>
      )}
    </div>
  );
}
