import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

/**
 * Vercel detects this entrypoint via zero-config NestJS support and runs the
 * exported handler as a Function. Locally `pnpm dev` runs the same module.
 *
 * Note: we do NOT use the global ValidationPipe — every controller parses its
 * input with Zod via @peec-lab/shared, which gives us better error messages
 * and avoids a class-validator/class-transformer dependency.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });

  // CORS for the Next.js web app to call us cross-origin during development.
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
