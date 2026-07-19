import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
try {
  const lead = await p.contact.findFirst({ 
    where: { type: "lead" }, 
    select: { id: true, userId: true, name: true, phone: true } 
  });
  console.log("TEST_LEAD:", JSON.stringify(lead));
} finally {
  await p.$disconnect();
}