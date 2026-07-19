const http = require('http');
function doReq(path, method = 'GET', hdrs = {}, body = null) {
  return new Promise((resolve) => {
    const opts = { hostname: '127.0.0.1', port: 4000, path, method, headers: { ...hdrs } };
    if (body) {
      const b = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(b);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
(async () => {
  const email = 'combined-' + Date.now() + '@ex.com';
  console.log('OPTIONS from 3001:');
  let o = await doReq('/api/auth/register', 'OPTIONS', { 'Origin': 'http://localhost:3001', 'Access-Control-Request-Method': 'POST' });
  console.log('Status:', o.status, 'Origin:', o.headers['access-control-allow-origin']);
  console.log('Register from 3001:');
  let r = await doReq('/api/auth/register', 'POST', { 'Origin': 'http://localhost:3001' }, { email, password: 'Test123!', name: 'Comb' });
  console.log('Register status:', r.status);
  console.log('Login from 3001:');
  r = await doReq('/api/auth/login', 'POST', { 'Origin': 'http://localhost:3001' }, { email, password: 'Test123!' });
  console.log('Login status:', r.status);
  console.log('OPTIONS from 3000:');
  o = await doReq('/api/auth/register', 'OPTIONS', { 'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' });
  console.log('3000 Status:', o.status, 'Origin:', o.headers['access-control-allow-origin']);
  console.log('Verification complete.');
})();
