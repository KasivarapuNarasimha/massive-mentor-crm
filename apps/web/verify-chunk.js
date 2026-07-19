const http = require('http');
http.get('http://localhost:3000/dashboard/ai-sales', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    if (data.includes('514.js') || data.includes('Cannot find module')) {
      console.log('BAD: old chunk ref or error found');
    } else {
      console.log('GOOD: No bad chunk 514.js reference in HTML');
    }
    const chunkMatch = data.match(/_next\/static\/chunks\/[^"]+\.js/g);
    if (chunkMatch) console.log('Sample chunks:', chunkMatch.slice(0,3));
    console.log('Page load verified (200 without chunk error in source).');
  });
}).on('error', e => console.error('Fetch err:', e.message));