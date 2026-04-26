import { parse as parseYaml, YAMLError } from 'yaml';
import { z } from 'zod';
import { experimentYamlSchema, type ExperimentYaml } from '../schema/experiment-yaml.js';

export class ExperimentYamlParseError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ExperimentYamlParseError';
    this.cause = cause;
  }
}

export interface ParseSuccess {
  ok: true;
  data: ExperimentYaml;
}

export interface ParseFailure {
  ok: false;
  errors: ReadonlyArray<{ path: string; message: string }>;
  raw?: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Parse a raw experiment.yaml string into a typed value. Returns a discriminated
 * union so callers can decide whether to throw or surface errors as a PR comment.
 */
export function parseExperimentYaml(raw: string): ParseResult {
  let parsedRaw: unknown;
  try {
    parsedRaw = parseYaml(raw);
  } catch (err) {
    const message = err instanceof YAMLError ? err.message : 'Invalid YAML';
    return { ok: false, errors: [{ path: '', message }], raw };
  }
  if (parsedRaw === null || parsedRaw === undefined) {
    return { ok: false, errors: [{ path: '', message: 'experiment.yaml is empty' }], raw };
  }
  const parsed = experimentYamlSchema.safeParse(parsedRaw);
  if (!parsed.success) {
    return { ok: false, errors: zodErrorToList(parsed.error), raw };
  }
  return { ok: true, data: parsed.data };
}

export function parseExperimentYamlOrThrow(raw: string): ExperimentYaml {
  const r = parseExperimentYaml(raw);
  if (!r.ok) {
    throw new ExperimentYamlParseError(
      r.errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('\n'),
    );
  }
  return r.data;
}

function zodErrorToList(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
