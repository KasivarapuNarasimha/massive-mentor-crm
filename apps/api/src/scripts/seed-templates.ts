import "dotenv/config";
import { seedIndustryTemplates } from "../services/template.service.js";

async function main() {
  const result = await seedIndustryTemplates();
  console.log("Template seed complete:", result);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
