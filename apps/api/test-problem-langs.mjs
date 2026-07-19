import { generateWhatsAppMessage } from './src/services/crm.service.ts';
const USER_ID = 'cmr4ubxas0006ty4wrj6d4fa2';
const CONTACT_ID = 'cmr4uervm0009ty4wosp3axgb';
const tests = ['te', 'ta', 'kn', 'ml', 'pa', 'or'];
for (const lang of tests) {
  try {
    const r = await generateWhatsAppMessage(USER_ID, CONTACT_ID, 'Professional', lang);
    const hasNative = /[\u0C00-\u0C7F\u0B80-\u0BFF\u0C80-\u0CFF\u0D00-\u0D7F\u0A00-\u0A7F\u0B00-\u0B7F]/.test(r.message);
    console.log(lang + ': len=' + r.message.length + ' hasNativeScript=' + hasNative);
    console.log('  sample: ' + r.message.substring(0,60).replace(/\n/g, ' '));
  } catch(e) { console.log(lang + ' FAIL: ' + e.message); }
}