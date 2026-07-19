import http from 'http';
const base = 'http://127.0.0.1:4000';
function req(path, method='GET', body=null, token=null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {hostname: '127.0.0.1', port: 4000, path, method, headers: {'Content-Type': 'application/json'}};
    if (data) { opts.headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) { opts.headers['Authorization'] = 'Bearer ' + token; }
    const r = http.request(opts, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({status: res.statusCode, body: d}));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
(async () => {
  const email = 'wa-debug-' + Date.now() + '@ex.com';
  const pass = 'P@ss123!';
  let r = await req('/api/auth/register', 'POST', {email, password: pass, name: 'Dbg'});
  console.log('reg:', r.status);
  r = await req('/api/auth/login', 'POST', {email, password: pass});
  console.log('login:', r.status);
  const tok = JSON.parse(r.body).data.token;
  r = await req('/api/crm/contacts', 'POST', {type:'lead', name:'DbgLead', status:'new'}, tok);
  console.log('contact:', r.status);
  const cid = JSON.parse(r.body).data.id;
  console.log('cid:', cid);
  r = await req('/api/crm/ai/whatsapp', 'POST', {contactId: cid, tone:'Professional', language:'te'}, tok);
  console.log('wa te:', r.status);
  console.log('body:', r.body);
  r = await req('/api/crm/ai/whatsapp', 'POST', {contactId: cid, tone:'Professional', language:'ta'}, tok);
  console.log('wa ta:', r.status);
  console.log('body:', r.body);
})();
