import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { SnapshotsModule } from '../snapshots/snapshots.module.js';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { ExperimentsModule } from '../experiments/experiments.module.js';
import { VerdictNotifierService } from './verdict-notifier.service.js';

@Module({
  imports: [SnapshotsModule, AnalysisModule, ExperimentsModule],
  controllers: [JobsController],
  providers: [JobsService, VerdictNotifierService],
  exports: [VerdictNotifierService],
})
export class JobsModule {}
