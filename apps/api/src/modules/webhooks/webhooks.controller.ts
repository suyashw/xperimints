import { Body, Controller, ForbiddenException, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service.js';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post('github')
  async github(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') eventType: string | undefined,
    @Body() body: unknown,
  ) {
    const raw = JSON.stringify(body);
    if (!this.service.verifyGithub(raw, signature)) {
      throw new ForbiddenException('Invalid GitHub signature');
    }
    await this.service.logAndStash({
      source: 'github',
      eventType,
      headers: scrubHeaders(req.headers),
      body,
      signature,
    });
    let result: unknown = null;
    if (eventType === 'pull_request') {
      result = await this.service.handleGithubPullRequest(
        body as Parameters<WebhooksService['handleGithubPullRequest']>[0],
      );
    }
    return { ok: true, eventType, result };
  }

  @Post('vercel')
  async vercel(
    @Req() req: Request,
    @Headers('x-vercel-signature') signature: string | undefined,
    @Headers('x-vercel-event') eventType: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const raw = JSON.stringify(body);
    if (!this.service.verifyVercel(raw, signature)) {
      throw new ForbiddenException('Invalid Vercel signature');
    }
    await this.service.logAndStash({
      source: 'vercel',
      eventType,
      headers: scrubHeaders(req.headers),
      body,
      signature,
    });
    let launchedExperimentId: string | null = null;
    if (eventType === 'deployment.succeeded') {
      launchedExperimentId = await this.service.handleVercelDeploymentSucceeded(
        body as Parameters<WebhooksService['handleVercelDeploymentSucceeded']>[0],
      );
    }
    return { ok: true, eventType, launchedExperimentId };
  }
}

function scrubHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase().includes('cookie')) continue;
    if (k.toLowerCase().includes('authorization')) continue;
    out[k] = v;
  }
  return out;
}
