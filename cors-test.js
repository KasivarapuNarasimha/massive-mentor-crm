const http = require('http');
function doReq(path, method='GET', headers={}) {
  return new Promise((resolve) => {
    const opts = { hostname: '127.0.0.1', port: 4000, path, method, headers };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: data}));
    });
    req.on('error', e => resolve({status:0, error: e.message}));
    req.end();
  });
}
(async () => {
  console.log('Health:');
  const h = await doReq('/health');
  console.log('Status:', h.status);
  console.log('OPTIONS from 3001:');
  const o = await doReq('/api/auth/register', 'OPTIONS', {'Origin': 'http://localhost:3001', 'Access-Control-Request-Method': 'POST'});
  console.log('Status:', o.status);
  console.log('ACA-Origin:', o.headers['access-control-allow-origin']);
  console.log('ACA-Credentials:', o.headers['access-control-allow-credentials']);
  console.log('ACA-Headers:', o.headers['access-control-allow-headers']);
  console.log('ACA-Methods:', o.headers['access-control-allow-methods']);
  console.log('POST register from 3001 (no body for test):');
  const p = await doReq('/api/auth/register', 'POST', {'Origin': 'http://localhost:3001', 'Content-Type': 'application/json'});
  console.log('POST Status:', p.status);
  console.log('POST Body:', p.body.substring(0,200));
})();
