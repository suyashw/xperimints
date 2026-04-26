import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Imported from the Nest-built CommonJS output. `nest build` runs as part of
// `vercel build` (see vercel.json buildCommand), so dist/main.js is present
// before this function is bundled by @vercel/node.
//
// This file is intentionally outside `tsconfig.json`'s `include` glob so tsc
// never tries to resolve `../dist/main.js` against missing types.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { createNestApp } = require('../dist/main.js') as {
  createNestApp: () => Promise<NestExpressApplication>;
};

// Cached across warm invocations — Nest bootstrap is expensive (Prisma client,
// module graph, MCP clients), so we only pay that cost on cold start.
let appPromise: Promise<NestExpressApplication> | null = null;

function getApp(): Promise<NestExpressApplication> {
  if (!appPromise) {
    appPromise = createNestApp();
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp(req, res);
}
