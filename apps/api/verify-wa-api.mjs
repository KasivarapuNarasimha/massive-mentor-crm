import http from 'http';

const base = 'http://127.0.0.1:4000';

function req(path, method='GET', body=null, token=null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: 4000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch(e) { resolve({status: res.statusCode, data: d}); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  console.log('Starting API verify for WhatsApp...');
  const email = 'wa-test-' + Date.now() + '@ex.com';
  const pass = 'Test123!';

  // register
  let r = await req('/api/auth/register', 'POST', {email, password: pass, name: 'WATest'});
  console.log('register:', r.status);
  if (!r.data.success) throw new Error('reg fail');

  // login
  r = await req('/api/auth/login', 'POST', {email, password: pass});
  console.log('login:', r.status);
  const token = r.data.data.token;

  // create contact for this user
  r = await req('/api/crm/contacts', 'POST', {type: 'lead', name: 'WATestLead', status: 'new', email: 'l@ex.com'}, token);
  console.log('create contact:', r.status);
  const cid = r.data.data.id;  // assume returns the created

  // now call whatsapp
  r = await req('/api/crm/ai/whatsapp', 'POST', {contactId: cid, tone: 'Professional', language: 'te'}, token);
  console.log('whatsapp te:', r.status);
  if (r.data && r.data.data && r.data.data.message) {
    console.log('  message len:', r.data.data.message.length);
    console.log('  sample:', r.data.data.message.substring(0,50));
  }

  r = await req('/api/crm/ai/whatsapp', 'POST', {contactId: cid, tone: 'Friendly', language: 'ta'}, token);
  console.log('whatsapp ta:', r.status);

  console.log('API WhatsApp verify done.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
