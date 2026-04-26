# Peec AI MCP challenge solutions
_Exported on 22/04/2026 at 19:43:29 GMT+5:30 from Cursor (3.1.17)_

---

**User**

Role: Act like an expert hackathon winner.

Scope: You can analyze gap areas/problem statements and can suggest mvp solutions that actually could be used by many.

Context: We have a MCP challenge https://peec.ai/mcp-challenge plus here are some use cases https://peec.ai/mcp-use-cases 

Focus on creating 5 short problem statements and give step by step solution for each of them to create winning solution for Peec AI.

Do 4-5 iterations before presenting the information in response.

I have attached the Peec AI MCP as well for your reference.

---

**Cursor**

I've pulled apart the Peec MCP toolset (`get_brand_report`, `get_domain_report`, `get_url_report`, `get_url_content`, `list_search_queries`, `list_chats`, `get_chat`, `get_actions`, `create_prompt`, plus the prebuilt prompts `peec_campaign_tracker`, `peec_prompt_grader`, `peec_topic_heatmap`, `peec_source_authority`, etc.) and cross-referenced the [existing use cases](https://peec.ai/mcp-use-cases) so I'm not pitching anything Peec already showcases.

Below are 5 problem statements with step-by-step MVP plans. They're picked to win the judging rubric — Usefulness 40% / Creativity 30% / Execution 20% / Community Impact 10% — and to lean into the "real marketing engineer" framing the [challenge page](https://peec.ai/mcp-challenge) emphasizes. Each one combines Peec MCP with at least one other MCP (Firecrawl, GitHub, Linear, Gmail, Vercel) so the workflow is repeatable, code-shaped, and shareable with `#BuiltWithPeec`.

---

## 1. Citation-Takeover Brief Generator

**Problem.** Marketers know *that* a competitor wins an AI answer, but never *why* their cited URL beat ours. Manually diffing competitor pages against your own is hours of grunt work per prompt.

**Why it wins.** None of the 12 listed use cases close the loop from "we lost this answer" → "here's the exact rewrite that gets us back in." Engineering-flavored (PRs to a docs repo) and falls cleanly into the **Content Optimization** category.

**MCP stack.** Peec MCP → Firecrawl MCP → GitHub MCP → Cursor.

**Step-by-step MVP**
1. **Day 1.** `list_prompts` filtered to a high-volume topic. For each prompt, run `get_brand_report` with `dimensions=[prompt_id, model_id]` and flag rows where `visibility = 0` AND a tracked competitor's `share_of_voice > 0.25`.
2. **Day 2.** For each losing prompt, call `list_chats` then `get_chat` to extract the cited competitor URLs ranked by citation_count.
3. **Day 3.** Pull our own most-cited URL on adjacent prompts (`get_url_report` filtered to `domain=ourbrand.com`). Use `get_url_content` for both, fall back to Firecrawl `/scrape` for competitor URLs Peec hasn't indexed.
4. **Day 4.** Run a structural diff in Cursor: section headings, FAQ blocks, schema.org markup, freshness dates, listicle entry counts, citations of primary sources.
5. **Day 5.** Generate a Markdown content brief with: target prompt, losing model engines, three concrete section additions, suggested H2/H3 outline, FAQ JSON-LD, and an embedded "before vs after" delta table.
6. **Day 6.** GitHub MCP opens a PR against the marketing/docs repo with the brief in `/briefs/{prompt-slug}.md` and tags the content owner.
7. **Day 7-8.** Wire `peec_campaign_tracker` to auto-trigger 14 days after merge to measure the lift; comment results back on the PR.
8. **Day 9.** Polish CLI / Cursor command: `npx peec-takeover --prompt "best CRM for startups"`.
9. **Day 10.** Record a 90-second Loom: prompt-in → PR-out → 2-week lift screenshot.

**Deliverable.** Open-source CLI + a sample PR on a public marketing repo with a real before/after lift chart. Massive #BuiltWithPeec viral potential because it produces a *thing engineers can merge*.

---

## 2. Reverse-Funnel Prompt Miner

**Problem.** Tracked prompt sets go stale fast. Engines fan out to dozens of *sub-queries* per prompt that you're not tracking — a giant blind spot. `peec_prompt_grader` audits what's there but can't surface what's missing.

**Why it wins.** Uses `list_search_queries` and `list_shopping_queries` — the most under-used Peec endpoints — to build a self-improving prompt set. Pure **Strategy & Research** category, very high creativity score.

**MCP stack.** Peec MCP only (zero external deps = high execution score).

**Step-by-step MVP**
1. **Day 1.** Pull the last 30d of fan-out queries: `list_search_queries` paginated across the whole project.
2. **Day 2.** Embed every fan-out query (OpenAI `text-embedding-3-small`) and cluster with HDBSCAN. Each cluster = a candidate "ghost prompt."
3. **Day 3.** For each cluster, pick the medoid query as the canonical phrasing. Cross-reference against `list_prompts` text to drop clusters you already track.
4. **Day 4.** Score each ghost prompt by (a) frequency of fan-out across chats, (b) number of distinct engines that issued it, (c) competitor `share_of_voice` in chats that fanned out to it (link via `chat_id`).
5. **Day 5.** Build a ranked "Untracked Demand" report: top 50 ghost prompts with volume, engine spread, and competitor exposure.
6. **Day 6.** With user confirmation, batch-call `create_prompt` to add the top N (assigning topic via embedding similarity to existing topics).
7. **Day 7.** Layer in `list_shopping_queries` for ecommerce projects → surfaces ghost product comparisons (e.g. "X vs Y under $50") competitors are winning.
8. **Day 8.** Schedule weekly re-run, post diff to Slack: "+12 ghost prompts surfaced this week, 3 added to tracking."
9. **Day 9.** Wrap as a Cursor slash-command: `/peec mine-ghosts`.
10. **Day 10.** Demo video: empty prompt set → 50 high-quality tracked prompts in 8 minutes.

**Deliverable.** A visibly *self-growing* tracking config — judges love systems that get better while they sleep.

---

## 3. AI-Visibility A/B Experiment Lab

**Problem.** Marketing teams ship content and PR pushes blind. They have no statistically defensible way to attribute AI-visibility lift to a specific change. `peec_campaign_tracker` does before/after but doesn't gate on significance or close the loop with where the change actually lives (a git commit).

**Why it wins.** Cleanly executes the "marketing engineer" thesis: treat content like code, with experiments, control groups, and PRs. **Reporting Automation** category but truly novel.

**MCP stack.** Peec MCP + GitHub MCP + Linear MCP + Vercel MCP (deploy webhook).

**Step-by-step MVP**
1. **Day 1.** Build an `experiment.yaml` schema: `{ id, hypothesis, target_prompts, control_prompts, treatment_url, launch_date, min_lift_pp }`.
2. **Day 2.** GitHub Action: when a PR labeled `geo-experiment` merges, parse `experiment.yaml`, snapshot baseline metrics via `get_brand_report` + `get_url_report` filtered to target prompts.
3. **Day 3.** Vercel deploy webhook stamps the launch_date the moment the content goes live in production (truer than guessing).
4. **Day 4.** Daily cron polls Peec; computes lift per prompt vs. control set; runs a permutation test on visibility & citation_rate.
5. **Day 5.** Day-14 verdict: build a markdown report — lift per engine, p-value, winner/loser/inconclusive label, top contributing chats (`list_chats` + `get_chat`).
6. **Day 6.** Auto-open Linear ticket "Experiment X: WIN +18pp on Perplexity" with chart and recommendation: "Roll forward / kill / extend."
7. **Day 7.** Build a small Next.js dashboard at `/experiments` with sparklines per active experiment, deployed to Vercel.
8. **Day 8.** Add power analysis upfront: warn the user if `target_prompts` × `engines` × `days` is too small to detect their `min_lift_pp`.
9. **Day 9.** Add cross-experiment dashboard: cumulative pp gained across all wins YTD.
10. **Day 10.** Demo: ship a real experiment, show automated Linear ticket + dashboard.

**Deliverable.** Open repo + GitHub Action others can drop into their own marketing site. Deeply engineering-coded, judges Lily Ray / Ethan Smith / Malte Landwehr will recognize the discipline gap this fills.

---

## 4. Editorial-Gap Pitch Composer

**Problem.** `peec_competitor_radar` tells you that competitors are cited in a TechCrunch listicle and you aren't — then dies. The actual outreach (find the journalist, find their email, write a personalized pitch with the right hook) is still 100% manual. This is the single biggest "last mile" problem in GEO.

**Why it wins.** Highest direct-revenue impact of any submission. **Competitive Analysis** category. Combines three MCPs in a non-obvious way.

**MCP stack.** Peec MCP + Firecrawl MCP + Gmail (or Apollo/HubSpot) MCP.

**Step-by-step MVP**
1. **Day 1.** Run `get_url_report` with `filters=[{field:'gap', operator:'gte', value:2}]` and `dimensions=[topic_id]` to pull URLs (listicles, comparisons) where ≥2 competitors are present and you're absent.
2. **Day 2.** For each gap URL, call `get_url_content` to grab the article markdown and extract: publication date, byline, list entries with reasoning text, contact links.
3. **Day 3.** Firecrawl `/scrape` the byline link / "About the author" page → extract email, X handle, LinkedIn.
4. **Day 4.** Build a "pitch prompt template": insert (a) which competitor entries are weakest (oldest data, missing categories), (b) what your brand uniquely offers vs those entries, (c) the journalist's recent topic angle from their author page.
5. **Day 5.** LLM drafts a 90-word personalized pitch + a one-line PS referencing their most recent article. Generate three variants per journalist for A/B.
6. **Day 6.** Output queue: a CSV / Linear board / Gmail drafts folder with `{journalist, outlet, gap_url, competitors_present, pitch_v1, pitch_v2, pitch_v3, suggested_send_date}`.
7. **Day 7.** Optional Gmail MCP: create drafts (never auto-send) so the user reviews before sending.
8. **Day 8.** Loop closure: tag the URL; when journalist publishes an updated listicle that now mentions you, `peec_campaign_tracker` reports the lift; auto-comment on the original Linear card.
9. **Day 9.** Add "outreach scoring": rank gap URLs by `retrieved_percentage × number_of_competitors_present × engine_spread` so users work the highest-leverage ones first.
10. **Day 10.** Live demo with one real journalist outreach (anonymized).

**Deliverable.** A pitch-ready inbox + measurable uplift loop. This is the use case I'd predict a category prize ($1.5K) for if executed well.

---

## 5. GEO Lighthouse — public AI-visibility score badge

**Problem.** Every brand wants a single, shareable number for "How visible am I in AI search?" Existing Peec dashboards are powerful but live behind a login and don't generate viral artifacts. PageSpeed/Lighthouse scores became ubiquitous because of the *badge* — GEO has no equivalent.

**Why it wins.** Maxes the **Community Impact (10%)** axis — every marketer who runs it embeds a badge linking back to Peec. Also strong on Creativity. The "lighthouse for AI search" framing is sticky.

**MCP stack.** Peec MCP + Vercel MCP for deploy + a lightweight Next.js app.

**Step-by-step MVP**
1. **Day 1.** Define the score: 0-100 weighted composite of `visibility` (35%), `share_of_voice` (25%), `citation_rate` of own domain (20%), `sentiment` normalized (10%), `engine_coverage` = fraction of tracked engines with non-zero visibility (10%).
2. **Day 2.** Build a public form: user enters their domain + 3 competitor domains + industry. Behind the scenes, programmatically seed 25 industry prompts (mined from the Reverse-Funnel miner #2, or templated from a pre-built taxonomy), `create_brand` for own + competitors, `create_prompt` for the 25.
3. **Day 3.** Wait 24h (Peec needs daily collection). In the meantime, cache results from the first dozen sample brands so the demo is instant.
4. **Day 4.** Day-2: pull `peec_engine_scorecard` + `peec_topic_heatmap`, compute the composite score, generate a shareable HTML report at `/score/{slug}`.
5. **Day 5.** Generate an SVG badge (`/badge/{slug}.svg` — green ≥70, amber 40–69, red <40) plus a snippet `<a href="..."><img src=".../badge.svg"></a>` for users to embed on their site.
6. **Day 6.** Generate a 5-card OG image for X/LinkedIn (engine-by-engine breakdown, weakest engine, top competitor lead, top recommendation from `get_actions`).
7. **Day 7.** Add public leaderboards by industry (opt-in). Powerful flywheel — brands pay attention to ranking.
8. **Day 8.** Embed a "Get the full audit" CTA → routes to `app.peec.ai` signup. Built-in growth loop for Peec.
9. **Day 9.** Deploy on Vercel via Vercel MCP, custom domain like `geoscore.dev`.
10. **Day 10.** Seed it with 30 well-known brands (Notion, Linear, Vercel, Stripe…), tweet the leaderboard with `#BuiltWithPeec`. Built-in PR moment.

**Deliverable.** A live URL anyone can run in 90 seconds, a badge thousands of marketers will embed, and a clear referral funnel for Peec — judges optimizing for community impact will weight this heavily.

---

## How I'd play the challenge

If I could only build one, I'd pick **#3 (A/B Experiment Lab)** for the grand prize — it's the one a judging panel of GEO practitioners (Lily Ray, Ethan Smith, Malte Landwehr) will recognize as solving their actual workflow gap. As a category-prize hedge, build **#5 (GEO Lighthouse)** in parallel — the viral badge mechanic plus public leaderboard is the highest-EV submission for community impact and it requires almost no overlap in code.

Want me to scaffold the repo for either of these (Next.js + the Peec MCP wiring + GitHub Action) so you can start coding tonight?

