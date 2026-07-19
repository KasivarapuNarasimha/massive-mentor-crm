import { generateWhatsAppMessage } from './src/services/crm.service.ts';

const USER_ID = 'cmr4ubxas0006ty4wrj6d4fa2';
const CONTACT_ID = 'cmr4uervm0009ty4wosp3axgb';

const languages = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'te', name: 'Telugu' },
  { code: 'ta', name: 'Tamil' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'bn', name: 'Bengali' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'or', name: 'Odia' },
  { code: 'as', name: 'Assamese' },
];

console.log('Testing WhatsApp generation for all languages...\n');

for (const lang of languages) {
  try {
    const result = await generateWhatsAppMessage(USER_ID, CONTACT_ID, 'Professional', lang.code);
    const msg = result.message || '';
    const preview = msg.length > 80 ? msg.substring(0, 77) + '...' : msg;
    console.log(`✅ ${lang.name} (${lang.code}): ${msg.length} chars`);
    console.log(`   Preview: ${preview.replace(/\n/g, ' ')}\n`);
  } catch (err) {
    console.log(`❌ ${lang.name} (${lang.code}): ${err.message}\n`);
  }
}

console.log('All tests completed.');