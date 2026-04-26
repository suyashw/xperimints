/**
 * Cross-package smoke test that proves every shipped experiment-templates/*.yaml
 * round-trips through experimentYamlSchema. Prevents the templates from
 * silently drifting from the schema.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExperimentYaml } from '@peec-lab/shared';

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(here, '..', '..', '..', 'examples', 'experiment-templates');

const templateFiles = readdirSync(templatesDir).filter((f) => f.endsWith('.yaml'));

describe('examples/experiment-templates', () => {
  it('contains at least 5 templates', () => {
    expect(templateFiles.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of templateFiles) {
    it(`${f} validates against experimentYamlSchema`, () => {
      const raw = readFileSync(join(templatesDir, f), 'utf8');
      const r = parseExperimentYaml(raw);
      if (!r.ok) {
        const errs = r.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
        throw new Error(`${f} failed validation:\n${errs}`);
      }
    });
  }
});
