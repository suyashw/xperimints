import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __peecLabPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__peecLabPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__peecLabPrisma = prisma;
}

export * from '@prisma/client';
