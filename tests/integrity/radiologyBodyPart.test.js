/**
 * Radiology requests carry the part/region the doctor chose ("Abdomen,
 * Pelvis"), from both LIS request points through to the radiologist's page
 * and printed report.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('server', () => {
  test('migration adds radiology_requests.body_part idempotently', () => {
    expect(read('src/server/scripts/migrateRadiologyModule.js'))
      .toMatch(/ALTER TABLE radiology_requests ADD COLUMN IF NOT EXISTS body_part VARCHAR\(255\)/);
  });

  const src = read('src/server/routes/radiology.js');

  test('request creation stores body_part, trimmed and capped at the column size', () => {
    const post = src.slice(src.indexOf("router.post('/requests'"), src.indexOf("router.get('/requests'"));
    expect(post).toMatch(/exam_name, body_part, doctor_id/);
    expect(post).toMatch(/:examName, :bodyPart, :doctorId/);
    expect(post).toMatch(/bodyPart: String\(item\.body_part \|\| ''\)\.trim\(\)\.slice\(0, 255\) \|\| null/);
  });

  test('the request list returns body_part (detail/visit already select rr.*)', () => {
    const list = src.slice(src.indexOf("router.get('/requests'"), src.indexOf("router.get('/visits'"));
    expect(list).toMatch(/rr\.body_part/);
  });
});

describe('LIS order screens', () => {
  const src = read('src/pages/lis/LISTestOrders.tsx');

  test('Place Order sends the part chosen for each exam', () => {
    expect(src).toMatch(/exam_name: exam\.name, body_part: radiologyBodyParts\[exam\.id\] \|\| null/);
  });

  test('Request Another Service sends the part chosen for each radiology item', () => {
    expect(src).toMatch(/exam_name: i\.name, body_part: reqRadiologyBodyParts\[i\.key\] \|\| null/);
  });

  test('both screens render the part picker', () => {
    expect(src.match(/<RadiologyBodyPartPicker/g)).toHaveLength(2);
  });
});

describe('radiologist page', () => {
  const src = read('src/pages/radiology/RadiologyRequestDetail.tsx');

  test('shows the part on the request card and the printed report', () => {
    expect(src).toMatch(/Part \/ Region<\/td>/);
    expect(src).toMatch(/cells: \['Part \/ Region', request\.body_part\]/);
  });
});
