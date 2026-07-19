const http = require('http');
function test(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const opts = { hostname: '127.0.0.1', port: 4000, path, method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}
(async () => {
  console.log('Testing health...');
  const h = await test('/health');
  console.log('HEALTH status:', h.status);
  if (h.data) console.log('HEALTH body sample:', h.data.substring(0, 100));
  console.log('Testing login...');
  const l = await test('/api/auth/login', 'POST', JSON.stringify({ email: 'test@ex.com', password: 'x' }));
  console.log('LOGIN status:', l.status);
  console.log('Testing /api ...');
  const a = await test('/api');
  console.log('API root status:', a.status);
  console.log('Done tests.');
})();