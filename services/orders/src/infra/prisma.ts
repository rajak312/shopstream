import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export { Prisma, PrismaClient };
export type Tx = Prisma.TransactionClient;

export function createPrisma(databaseUrl: string, poolSize = 10): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: poolSize });
  return new PrismaClient({ adapter });
}
