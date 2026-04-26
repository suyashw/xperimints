import { Logger } from '@nestjs/common';
import { decodeRows, type ColumnarResponse } from '@peec-lab/mcp-clients';

/**
 * Builds the one-sentence project description that the dashboard header
 * shows in place of the raw `peec_project_id`. We persist the output on
 * `PeecProject.cachedDescription` so the page never has to make this call
 * at render time and never has to fall back to leaking the upstream id.
 *
 * Strategy:
 *   1. Peec MCP doesn't currently surface a project description (per
 *      `list_projects`'s columns: id, name, status). So we derive it from
 *      the project name + the cached brand / topic / model signals we just
 *      synced.
 *   2. When `OPENAI_API_KEY` is set we ask OpenAI for a single sentence —
 *      same pattern as `prompt-hypothesis.service`.
 *   3. Otherwise (and on any OpenAI error) we fall back to a deterministic
 *      heuristic so the demo works key-less and the description is always
 *      something more useful than the project id.
 */

const log = new Logger('ProjectDescription');

interface DescribeInput {
  projectName: string;
  brandRows: ColumnarResponse;
  topicRows: ColumnarResponse;
  modelIds: string[];
  promptRows: ColumnarResponse;
}

export async function generateProjectDescription(
  input: DescribeInput,
): Promise<string> {
  const summary = summarize(input);
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    const aiText = await tryOpenAi(apiKey, summary);
    if (aiText) return aiText;
  }
  return buildHeuristic(summary);
}

interface ProjectSummary {
  projectName: string;
  ownBrandName: string | null;
  competitorNames: string[];
  topicNames: string[];
  modelIds: string[];
  promptCount: number;
  brandCount: number;
  // Up to 3 representative prompts, used as flavour for the LLM (and to
  // avoid the heuristic being entirely numeric).
  samplePrompts: string[];
}

function summarize(input: DescribeInput): ProjectSummary {
  const brands = decodeRows<{ id?: string; name?: string; is_own?: boolean }>(
    input.brandRows,
  );
  const projectNorm = input.projectName.trim().toLowerCase();
  const ownBrand =
    brands.find((b) => b.is_own === true) ??
    brands.find(
      (b) =>
        typeof b.name === 'string' && b.name.trim().toLowerCase() === projectNorm,
    ) ??
    null;
  const competitors = brands
    .filter((b) => b !== ownBrand && typeof b.name === 'string')
    .map((b) => b.name as string);

  const topics = decodeRows<{ id?: string; name?: string }>(input.topicRows)
    .map((t) => t.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);

  const promptDecoded = decodeRows<{
    id?: string;
    text?: string;
    prompt?: string;
    content?: string;
    messages?: Array<{ content?: unknown }> | string;
  }>(input.promptRows);
  const samplePrompts: string[] = [];
  for (const p of promptDecoded) {
    const text = extractPromptText(p);
    if (text) samplePrompts.push(text);
    if (samplePrompts.length >= 3) break;
  }

  return {
    projectName: input.projectName,
    ownBrandName: ownBrand?.name ?? null,
    competitorNames: dedupe(competitors).slice(0, 5),
    topicNames: dedupe(topics).slice(0, 5),
    modelIds: input.modelIds.slice(0, 5),
    promptCount: input.promptRows.rowCount,
    brandCount: input.brandRows.rowCount,
    samplePrompts,
  };
}

function extractPromptText(row: {
  text?: string;
  prompt?: string;
  content?: string;
  messages?: Array<{ content?: unknown }> | string;
}): string | null {
  if (typeof row.text === 'string' && row.text.length > 0) return row.text;
  if (typeof row.prompt === 'string' && row.prompt.length > 0) return row.prompt;
  if (typeof row.content === 'string' && row.content.length > 0) return row.content;
  if (Array.isArray(row.messages)) {
    for (const m of row.messages) {
      if (m && typeof m.content === 'string' && m.content.length > 0) return m.content;
    }
  } else if (typeof row.messages === 'string' && row.messages.length > 0) {
    return row.messages;
  }
  return null;
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

async function tryOpenAi(apiKey: string, s: ProjectSummary): Promise<string | null> {
  const userPrompt = buildLlmPrompt(s);
  const sysPrompt =
    'You write short, neutral product descriptions for an internal AI-search visibility tool. ' +
    'Given a Peec project (a brand whose visibility across LLM search engines is being tracked), ' +
    'output ONE sentence (≤220 characters, no trailing period required) that describes what this project tracks: ' +
    'what brand, what topical area, and against which competitors if applicable. ' +
    'Return JSON: { description: string }. Do NOT include any internal IDs, dates, model IDs, or numeric counts.';
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_DESCRIPTION_MODEL ?? 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      log.warn(`OpenAI description call ${res.status}; falling back to heuristic`);
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { description?: unknown };
    if (typeof parsed.description !== 'string') return null;
    const trimmed = parsed.description.trim();
    if (trimmed.length === 0) return null;
    return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 237)}…`;
  } catch (err) {
    log.warn(`OpenAI description call failed (${(err as Error).message}); using heuristic`);
    return null;
  }
}

function buildLlmPrompt(s: ProjectSummary): string {
  const lines: string[] = [];
  lines.push(`Project name: ${s.projectName}`);
  lines.push(`Tracked brand: ${s.ownBrandName ?? '(unspecified — assume the brand is the project name)'}`);
  if (s.competitorNames.length > 0) {
    lines.push(`Competitors tracked: ${s.competitorNames.join(', ')}`);
  }
  if (s.topicNames.length > 0) {
    lines.push(`Topical areas: ${s.topicNames.join(', ')}`);
  }
  if (s.samplePrompts.length > 0) {
    lines.push('Example tracked prompts:');
    for (const p of s.samplePrompts) {
      lines.push(`  - ${truncate(p, 140)}`);
    }
  }
  lines.push(
    'Write ONE sentence describing what this Peec project tracks. ' +
      'Mention the brand and (if relevant) the topical area or competitive set. ' +
      'No counts, no IDs.',
  );
  return lines.join('\n');
}

function buildHeuristic(s: ProjectSummary): string {
  const subject = s.ownBrandName ?? s.projectName;
  const topicPhrase =
    s.topicNames.length > 0
      ? ` across ${formatList(s.topicNames.slice(0, 3))}`
      : '';
  const competitorPhrase =
    s.competitorNames.length > 0
      ? ` vs ${formatList(s.competitorNames.slice(0, 3))}`
      : '';
  return `Tracks ${subject}'s visibility on AI search engines${topicPhrase}${competitorPhrase}.`;
}

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
