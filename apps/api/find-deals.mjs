import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const deals = await p.deal.findMany({ take: 2, include: { contact: true } });
console.dir(deals, {depth: 2});
await p.$disconnect();