import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

/**
 * Standard Nest bootstrap. Vercel's zero-configuration NestJS support
 * (Fluid Compute) detects this entry point automatically and intercepts
 * `app.listen()` to wire it into the function runtime — so the same code
 * runs locally (binds to PORT) and on Vercel (becomes a Fluid function).
 *
 * Do NOT gate `bootstrap()` behind `process.env.VERCEL`: on Vercel the
 * runtime expects the entry point to start listening, otherwise it
 * reports `Invalid export found in module`.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
  app.enableCors({
    origin: (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').split(','),
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
