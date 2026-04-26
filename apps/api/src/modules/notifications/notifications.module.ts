import { Global, Module } from '@nestjs/common';
import { GitHubService } from './github.service.js';
import { LinearService } from './linear.service.js';

@Global()
@Module({
  providers: [GitHubService, LinearService],
  exports: [GitHubService, LinearService],
})
export class NotificationsModule {}
