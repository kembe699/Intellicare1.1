const http = require('http');
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname:'localhost', port:3002, path, method,
      headers: {'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})} };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(opts, res => { let d=''; res.on('data',x=>d+=x); res.on('end',()=>resolve({s:res.statusCode,b:d})); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
async function run() {
  const email = process.env.TEST_LOGIN_EMAIL;
  const password = process.env.TEST_LOGIN_PASSWORD;
  if (!email || !password) {
    console.error('Set TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD env vars before running this script.');
    process.exit(1);
  }
  const login = await req('POST','/api/auth/login',{email,password});
  const token = JSON.parse(login.b).token;

  const payload = {
    test: {
      test_name: 'ICT for Malaria',
      test_code: 'ICTT_TEST',
      category: 'Parasitology',
      clinic_id: '1',
      price: 0,
      service_id: '35338bc3-a2f1-4d7e-bbc5-100b8e307b7a',
      created_by: 'Admin Kembe'
    },
    components: [{ component_name: 'ICT for Malaria', unit: '', reference_range: '', sort_order: 0 }]
  };

  const r = await req('POST', '/api/lab-tests/with-components', payload, token);
  console.log('Status:', r.s);
  console.log('Body:', r.b.substring(0, 300));
}
run().catch(console.error).finally(() => process.exit());
