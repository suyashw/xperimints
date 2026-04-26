import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ActionGeneratorService } from './action-generator.service.js';

const ORG_HEADER = 'x-peec-lab-org';

const bodySchema = z
  .object({
    promptId: z.string().min(1),
    actionId: z.string().min(1).max(200),
  })
  .strict();

/**
 * Backs the per-action "Generate" button on /experiments/new.
 *
 *   POST /v1/peec/actions/generate { promptId, actionId } → ActionGeneration
 *
 * Always recomputes — generation is rare and explicit, so we don't
 * cache the LLM call. The result is upserted into ActionGenerationCache
 * by the service so a subsequent reload picks it up via
 * PromptHypothesisService.fetchGenerations.
 */
@Controller('peec/actions')
export class ActionGeneratorController {
  constructor(private readonly generator: ActionGeneratorService) {}

  @Post('generate')
  generate(
    @Headers(ORG_HEADER) organizationId: string,
    @Body() body: unknown,
  ) {
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
    return this.generator.generate(
      organizationId,
      parsed.data.promptId,
      parsed.data.actionId,
    );
  }
}
