import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { ExperimentsModule } from '../experiments/experiments.module.js';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { SnapshotsModule } from '../snapshots/snapshots.module.js';

@Module({
  imports: [ExperimentsModule, AnalysisModule, SnapshotsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
