import { generateWhatsAppMessage, logAiGeneration, getAiGenerations } from "./src/services/crm.service.ts";

const CONTACT_ID = "cmr4wzzuv0003ty7ormrs7ddg";
const USER_ID = "cmr4wzznf0000ty7og63n5nle";

async function main() {
  console.log("=== Feature 2 WhatsApp Full Test (Generate + Save + History) ===");
  try {
    const r1 = await generateWhatsAppMessage(USER_ID, CONTACT_ID, "Professional", "en");
    console.log("EN OK. Len:", r1.message?.length);

    await logAiGeneration(USER_ID, {
      contactId: CONTACT_ID,
      feature: "whatsapp",
      tone: "Professional",
      language: "en",
      content: r1.message,
    });

    const r2 = await generateWhatsAppMessage(USER_ID, CONTACT_ID, "Friendly", "te");
    await logAiGeneration(USER_ID, {
      contactId: CONTACT_ID,
      feature: "whatsapp",
      tone: "Friendly",
      language: "te",
      content: r2.message,
    });

    const history = await getAiGenerations(USER_ID, { contactId: CONTACT_ID, feature: "whatsapp" });
    console.log("HISTORY SAVED:", history.length);
    if (history.length > 0) {
      console.log("LATEST:", history[0].tone, history[0].language);
    }
    console.log("=== FEATURE2_BACKEND_DB_FULL_PASSED ===");
  } catch (e) {
    console.error("ERROR:", e?.message || e);
    process.exitCode = 1;
  }
}

main();