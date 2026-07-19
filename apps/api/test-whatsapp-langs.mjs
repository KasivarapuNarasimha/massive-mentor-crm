import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const leads = await prisma.contact.findMany({ where: { type: 'lead' }, take: 3, select: { id: true, userId: true, name: true } });
console.dir(leads);
await prisma.$disconnect();