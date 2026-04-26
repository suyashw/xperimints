import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { PromptHypothesisService } from './prompt-hypothesis.service.js';

const ORG_HEADER = 'x-peec-lab-org';

const bodySchema = z
  .object({
    promptId: z.string().min(1),
    // When true, bypass the PromptHypothesisCache row and recompute. Sent
    // by the modal's "Re-analyze" button. Defaults to false so opening
    // the modal multiple times is free after the first analysis.
    force: z.boolean().optional(),
  })
  .strict();

/**
 * Backs the dashboard's prompt-inspector modal:
 *
 *   POST /v1/peec/prompts/hypothesis  { promptId, force? } → { engineBreakdown, hypothesis, … }
 *
 * The route is POST (not GET) because the response is computed when the
 * cache is empty or `force` is true — including a live Peec MCP call and
 * an optional OpenAI roundtrip — so we don't want any intermediate cache
 * treating it as idempotent.
 */
@Controller('peec/prompts')
export class PromptHypothesisController {
  constructor(private readonly hypothesis: PromptHypothesisService) {}

  @Post('hypothesis')
  analyze(@Headers(ORG_HEADER) organizationId: string, @Body() body: unknown) {
    if (!organizationId) {
      throw new BadRequestException(`Missing ${ORG_HEADER} header`);
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
      );
    }
    return this.hypothesis.analyze(organizationId, parsed.data.promptId, {
      force: parsed.data.force ?? false,
    });
  }
}
