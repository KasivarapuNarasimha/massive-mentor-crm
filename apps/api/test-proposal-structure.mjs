import { generateProposal } from './src/services/crm.service.ts';
const uid = 'cmr4u3s4j0000tyckq802a109';
const did = 'cmr4u9m9e0005ty4wvon256lh';
try {
  const res = await generateProposal(uid, did);
  console.log('Proposal type:', typeof res);
  console.dir(res, {depth: 3});
} catch(e) {
  console.error('Error:', e.message);
}