import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { ExperimentsModule } from '../experiments/experiments.module.js';

@Module({
  imports: [ExperimentsModule],
  controllers: [PublicController],
})
export class PublicModule {}
