const http = require('http');

const options = {
  hostname: 'localhost',
  port: 8080,
  path: '/api/reports/audit-logs?from=2024-01-01&to=2026-12-31',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('\n=== Audit Logs API Test ===\n');
      console.log('Status Code:', res.statusCode);
      console.log('Total Logs:', json.logs?.length || 0);
      console.log('Summary:', json.summary);
      console.log('\nAvailable Modules:', json.filters?.modules || []);
      console.log('Available Actions:', json.filters?.actions || []);
      
      if (json.logs && json.logs.length > 0) {
        console.log('\nSample Log Entry:');
        console.log(JSON.stringify(json.logs[0], null, 2));
      }
      
      console.log('\n=== Test Complete ===\n');
    } catch (e) {
      console.error('Parse error:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.end();
