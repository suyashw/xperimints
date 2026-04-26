import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service.js';
import { PowerAnalysisService } from './power-analysis.service.js';
import { ReportBuilderService } from './report-builder.service.js';

@Module({
  providers: [AnalysisService, PowerAnalysisService, ReportBuilderService],
  exports: [AnalysisService, PowerAnalysisService, ReportBuilderService],
})
export class AnalysisModule {}
