# Experiment templates

Drop-in [`experiment.yaml`](../../PLAN.md#9-experimentyaml-schema-the-user-facing-artifact) starters for the most common GEO experiments. Fork the one closest to your situation, replace the `prompt_id` placeholders with real Peec prompt IDs (`peec-lab projects` → `peec-lab` will surface them when wired against your account), and open a PR labelled `geo-experiment` against your marketing repo.

Each template has been validated against `experimentYamlSchema` in [`@peec-lab/shared`](../../packages/shared).

| Template | Use it when… |
|---|---|
| [`saas-listicle-rewrite.yaml`](./saas-listicle-rewrite.yaml) | You're a SaaS rewriting a "best X for Y" listicle to add an FAQ + comparison table. |
| [`ecommerce-comparison-hub.yaml`](./ecommerce-comparison-hub.yaml) | You're an ecommerce store building a product-comparison hub page. |
| [`b2b-services-case-study-schema.yaml`](./b2b-services-case-study-schema.yaml) | You're a B2B services co. adding `Article` + `Case Study` schema markup. |
| [`devtools-best-x-for-y.yaml`](./devtools-best-x-for-y.yaml) | You're a dev tools company expanding into "ghost" search-query subspace. |
| [`agency-author-bios-citations.yaml`](./agency-author-bios-citations.yaml) | You're an agency adding author bios and primary-source citations. |
