import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

/**
 * Build a fully-configured Nest application without binding to a port.
 *
 * Used by:
 *   - Local dev (`bootstrap` below) — wraps this with `app.listen`.
 *   - The Vercel serverless handler in `apps/api/api/index.ts` — reuses
 *     the underlying Express instance for each invocation.
 *
 * We intentionally skip the global ValidationPipe; controllers parse input
 * with Zod via @peec-lab/shared for richer errors and no class-validator
 * runtime dependency.
 */
export async function createNestApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
  app.enableCors({
    origin: (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  await app.init();
  return app;
}

async function bootstrap() {
  const app = await createNestApp();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
}

if (!process.env.VERCEL) {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal bootstrap error', err);
    process.exit(1);
  });
}
