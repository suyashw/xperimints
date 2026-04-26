import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { IntegrationType } from '@peec-lab/database';
import { IntegrationsService } from './integrations.service.js';

const ORG_HEADER = 'x-peec-lab-org';

const integrationTypeSchema = z.nativeEnum(IntegrationType);

const connectBodySchema = z
  .object({
    credentials: z.record(z.string()).refine((v) => Object.keys(v).length > 0, {
      message: 'credentials must include at least one field (e.g. token)',
    }),
    config: z.record(z.unknown()).optional(),
  })
  .strict();

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  /** List the four supported integrations + their connection state. */
  @Get()
  list(@Headers(ORG_HEADER) organizationId: string) {
    requireOrg(organizationId);
    return this.service.list(organizationId);
  }

  /**
   * Connect (or reconnect) an integration. We probe the upstream first and
   * only persist the (encrypted) credentials when the probe succeeds. If the
   * upstream returns a refreshed/exchanged token in the future (e.g. OAuth
   * code-for-token), the service swaps that in before encrypting.
   */
  @Post(':type/connect')
  async connect(
    @Headers(ORG_HEADER) organizationId: string,
    @Param('type') typeParam: string,
    @Body() body: unknown,
  ) {
    requireOrg(organizationId);
    const type = parseType(typeParam);
    const parsed = connectBodySchema.parse(body);
    return this.service.connect(organizationId, {
      type,
      credentials: parsed.credentials,
      config: parsed.config,
    });
  }

  /** Re-validate the stored credentials and refresh the card status. */
  @Post(':type/test')
  test(
    @Headers(ORG_HEADER) organizationId: string,
    @Param('type') typeParam: string,
  ) {
    requireOrg(organizationId);
    const type = parseType(typeParam);
    return this.service.test(organizationId, type);
  }

  @Delete(':type')
  async remove(
    @Headers(ORG_HEADER) organizationId: string,
    @Param('type') typeParam: string,
  ) {
    requireOrg(organizationId);
    const type = parseType(typeParam);
    await this.service.disconnect(organizationId, type);
    return { ok: true };
  }
}

function requireOrg(orgId: string | undefined): asserts orgId is string {
  if (!orgId) throw new BadRequestException(`Missing ${ORG_HEADER} header`);
}

function parseType(raw: string): IntegrationType {
  const result = integrationTypeSchema.safeParse(raw.toUpperCase());
  if (!result.success) {
    throw new BadRequestException(
      `Unknown integration type "${raw}". Allowed: ${Object.values(IntegrationType).join(', ')}`,
    );
  }
  return result.data;
}
