import { Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { JobsService } from './jobs.service.js';

/**
 * Vercel Cron invokes these endpoints with `Authorization: Bearer ${CRON_SECRET}`.
 * We verify in-band rather than via guard so the handlers stay flat.
 */
@Controller('internal/cron')
export class JobsController {
  constructor(private readonly service: JobsService) {}

  @Post('daily-snapshots')
  async dailySnapshots(@Headers('authorization') auth?: string) {
    requireCronAuth(auth);
    return this.service.runDailySnapshots();
  }

  @Post('finalize-due-experiments')
  async finalize(@Headers('authorization') auth?: string) {
    requireCronAuth(auth);
    return this.service.runFinalizeDue();
  }
}

function requireCronAuth(header: string | undefined): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) return; // dev mode bypass
  if (header !== `Bearer ${secret}`) {
    throw new ForbiddenException('Invalid cron secret');
  }
}
