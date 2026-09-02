// Test the same kind of update the frontend sends
const http = require('http');

const schemeId = 'a3f1442b-fc57-4b68-b66d-d49343343c45';
const payload = JSON.stringify({
  scheme_name: 'National Health Insurance Fund',
  scheme_description: '',
  scheme_type: 'insurance',
  is_default: false,
  pricing_strategy: 'fixed',
  base_markup_percentage: '0',
  base_discount_percentage: '0',
  is_insurance: true,
  insurance_provider_name: '',
  insurance_provider_code: '',
  requires_authorization: false,
  has_copay: true,
  default_copay_percentage: '10',
  copay_cap_per_visit: '',
  payment_terms: 'immediate',
  is_credit_allowed: false,
  credit_limit: '0',
  requires_deposit: false,
  deposit_amount: '',
  allows_negotiation: false,
  requires_verification: false,
  requires_approval: false,
  contact_person: '',
  contact_phone: '',
  contact_email: '',
  notes: '',
  currency: 'USD',
  clinic_id: 1
});

const options = {
  hostname: '127.0.0.1',
  port: 3002,
  path: `/api/schemes/${schemeId}`,
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(payload);
req.end();
