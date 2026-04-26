import { Global, Module } from '@nestjs/common';
import { PeecMcpService } from './peec-mcp.service.js';
import { PeecSyncService } from './peec-sync.service.js';
import { PeecSyncController } from './peec-sync.controller.js';
import { PeecOAuthService } from './peec-oauth.service.js';
import { PeecOAuthController } from './peec-oauth.controller.js';
import { PromptHypothesisService } from './prompt-hypothesis.service.js';
import { PromptHypothesisController } from './prompt-hypothesis.controller.js';
import { ActionGeneratorService } from './action-generator.service.js';
import { ActionGeneratorController } from './action-generator.controller.js';
import { SnapshotsModule } from '../snapshots/snapshots.module.js';

@Global()
@Module({
  imports: [SnapshotsModule],
  controllers: [
    PeecSyncController,
    PeecOAuthController,
    PromptHypothesisController,
    ActionGeneratorController,
  ],
  providers: [
    PeecMcpService,
    PeecSyncService,
    PeecOAuthService,
    PromptHypothesisService,
    ActionGeneratorService,
  ],
  exports: [
    PeecMcpService,
    PeecSyncService,
    PeecOAuthService,
    PromptHypothesisService,
    ActionGeneratorService,
  ],
})
export class PeecModule {}
