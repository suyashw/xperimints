import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readyz')
  readiness() {
    // In a richer impl this would ping the DB and Peec. Hobby cold-start budget is tight,
    // so we keep it cheap.
    return { status: 'ready' };
  }
}
