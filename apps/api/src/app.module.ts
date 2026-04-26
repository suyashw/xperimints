import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module.js';
import { ExperimentsModule } from './modules/experiments/experiments.module.js';
import { PeecModule } from './modules/peec/peec.module.js';
import { SnapshotsModule } from './modules/snapshots/snapshots.module.js';
import { AnalysisModule } from './modules/analysis/analysis.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PeecModule,
    NotificationsModule,
    HealthModule,
    ExperimentsModule,
    SnapshotsModule,
    AnalysisModule,
    JobsModule,
    WebhooksModule,
    PublicModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
