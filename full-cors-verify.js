const http = require('http');
function doReq(path, method='GET', hdrs={}, body=null) {
  return new Promise((resolve) => {
    const opts = { hostname: '127.0.0.1', port: 4000, path, method, headers: { ...hdrs } };
    if (body) {
      const bstr = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(bstr);
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
  const email = 'corsfull-' + Date.now() + '@ex.com';
  const origin = 'http://localhost:3001';
  console.log('Full register from', origin);
  const reg = await doReq('/api/auth/register', 'POST', { 'Origin': origin }, { email, password: 'Test123!', name: 'FullCors' });
  console.log('Register status:', reg.status);
  console.log('Register body:', reg.body);
  console.log('ACA-Origin on response:', reg.headers['access-control-allow-origin']);
  console.log('ACA-Creds:', reg.headers['access-control-allow-credentials']);
  // login
  const log = await doReq('/api/auth/login', 'POST', { 'Origin': origin }, { email, password: 'Test123!' });
  console.log('Login status:', log.status);
  console.log('Login body sample:', log.body.substring(0,100));
  // test 3000 origin
  console.log('\nOPTIONS from 3000:');
  const o = await doReq('/api/auth/register', 'OPTIONS', { 'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' });
  console.log('3000 OPTIONS status:', o.status, 'origin:', o.headers['access-control-allow-origin']);
})();
