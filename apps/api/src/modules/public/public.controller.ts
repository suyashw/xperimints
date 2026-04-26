import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ExperimentsService } from '../experiments/experiments.service.js';

@Controller('public')
export class PublicController {
  constructor(private readonly experiments: ExperimentsService) {}

  /**
   * Unauthenticated public endpoint backing /r/{slug} on the web. Returns
   * only fields safe to expose: verdict, lift table, redacted org name.
   */
  @Get('r/:slug')
  async byShareSlug(@Param('slug') slug: string) {
    const exp = await this.experiments.getBySharedSlug(slug);
    if (!exp) throw new NotFoundException('Result not found or not public');
    return {
      slug,
      name: exp.name,
      hypothesis: exp.hypothesis,
      treatmentUrl: exp.treatmentUrl,
      status: exp.status,
      launchAt: exp.launchAt,
      endsAt: exp.endsAt,
      result: exp.result
        ? {
            verdict: exp.result.verdict,
            overallPValue: exp.result.overallPValue,
            liftByEngine: exp.result.liftByEngine,
            reportMarkdown: exp.result.reportMarkdown,
          }
        : null,
    };
  }
}
