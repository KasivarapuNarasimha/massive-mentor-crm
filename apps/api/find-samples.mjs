import {PrismaClient} from "@prisma/client";
const p = new PrismaClient();
const users = await p.user.findMany({take:1, select:{id:true}});
const contacts = await p.contact.findMany({take:1});
const deals = await p.deal.findMany({take:1});
console.log("user:", users[0]?.id);
console.log("contact:", JSON.stringify(contacts[0], null, 2));
console.log("deal:", JSON.stringify(deals[0], null, 2));
await p.$disconnect();