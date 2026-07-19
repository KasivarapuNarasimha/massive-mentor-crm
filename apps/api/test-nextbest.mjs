import { generateNextBestAction } from './src/services/crm.service.ts';

const USER_ID = 'cmr4u3s4j0000tyckq802a109';
const CONTACT_ID = 'cmr4u9hfv0001ty4wj80ogz9j';
const DEAL_ID = 'cmr4u9m9e0005ty4wvon256lh';

console.log('Testing with contact...');
try {
  const res = await generateNextBestAction(USER_ID, 'contact', CONTACT_ID);
  const wrapped = { success: true, ...res };
  console.log('Contact wrapped:', JSON.stringify(wrapped, null, 2));
} catch(e) {
  console.error('Contact error:', e.message);
  console.error(e.stack);
}

console.log('\nTesting with deal...');
try {
  const res = await generateNextBestAction(USER_ID, 'deal', DEAL_ID);
  const wrapped = { success: true, ...res };
  console.log('Deal wrapped:', JSON.stringify(wrapped, null, 2));
} catch(e) {
  console.error('Deal error:', e.message);
  console.error(e.stack);
}
