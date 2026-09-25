/**
 * Multi-store prescribing/dispensing for the Inpatient ward flow. The data
 * model (stock_locations / stock_by_location) and the dispense endpoint's
 * from_location_id handling already existed — this covers what was added:
 * a lightweight locations list reachable by whoever can already see the
 * drug catalog (doctors), location-scoped stock on /drugs, and dispensing
 * actually validating against the chosen store's own stock instead of only
 * the clinic-wide total.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('GET /pharmacy-module/locations', () => {
  const src = read('src/server/routes/pharmacyModule.js');
  const routeSrc = src.slice(src.indexOf("router.get('/locations'"), src.indexOf("router.get('/locations'") + 1200);

  test('is gated by pharmacy.read (same as /drugs), not inventory.read', () => {
    const header = src.slice(src.indexOf("router.get('/locations'"), src.indexOf("router.get('/locations'") + 80);
    expect(header).toMatch(/authorize\('pharmacy\.read'\)/);
  });

  test('is branch-scoped the same way /drugs is', () => {
    expect(routeSrc).toMatch(/getBranchConditionSQL\(req, 'sl'\)/);
  });

  test('only returns active locations for this clinic', () => {
    expect(routeSrc).toMatch(/sl\.clinic_id = :cid/);
    expect(routeSrc).toMatch(/sl\.is_active = true/);
  });
});

describe('GET /pharmacy-module/drugs accepts an optional location_id', () => {
  const src = read('src/server/routes/pharmacyModule.js');
  const routeSrc = src.slice(src.indexOf("router.get('/drugs'"), src.indexOf("router.get('/drugs/:id'"));

  test('destructures location_id from the query', () => {
    expect(routeSrc).toMatch(/location_id/);
  });

  test('LEFT JOINs stock_by_location only when a location is given', () => {
    expect(routeSrc).toMatch(/LEFT JOIN stock_by_location sbl ON sbl\.item_id = i\.id AND sbl\.location_id = :locationId/);
  });

  test('reports that location\'s own stock (0 when unstocked there), not the clinic-wide total, when location_id is present', () => {
    expect(routeSrc).toMatch(/COALESCE\(sbl\.quantity_on_hand, 0\)/);
  });
});

describe('POST /pharmacy-module/dispensing validates the chosen store\'s own stock', () => {
  const src = read('src/server/routes/pharmacyModule.js');
  const routeSrc = src.slice(src.indexOf("router.post('/dispensing'"), src.indexOf("router.get('/returns'"));
  const stockSection = routeSrc.slice(routeSrc.indexOf('// 2. Check stock'), routeSrc.indexOf('// 3.') > -1 ? routeSrc.indexOf("Select batch") : routeSrc.length);

  test('queries stock_by_location for the chosen item + location when from_location_id was given', () => {
    expect(stockSection).toMatch(/FROM stock_by_location WHERE item_id = :itemId AND location_id = :locationId/);
  });

  test('rejects the dispense when the location-specific stock is insufficient, even if clinic-wide stock is not', () => {
    expect(stockSection).toMatch(/if \(cleanFromLocationId\)/);
    expect(stockSection).toMatch(/locAvailable < quantity_dispensed/);
    expect(stockSection).toMatch(/Insufficient stock at selected location/);
  });
});

describe('PatientDetails.tsx wires the store picker and dispense-now flow', () => {
  const src = read('src/pages/inpatient/PatientDetails.tsx');

  test('fetches stock locations from the new pharmacy.read-gated endpoint', () => {
    expect(src).toMatch(/\/api\/pharmacy-module\/locations/);
  });

  test('the drug catalog query passes location_id through when a store is selected', () => {
    expect(src).toMatch(/location_id=\$\{rxForm\.location_id\}/);
  });

  test('the Dispense Now checkbox is gated by the pharmacy.write privilege', () => {
    expect(src).toMatch(/hasPrivilege\('pharmacy\.write'\)/);
  });

  test('dispensing posts to /pharmacy-module/dispensing with prescription_line_id and from_location_id', () => {
    const mutSrc = src.slice(src.indexOf('const rxMut = useMutation'), src.indexOf('const rxMut = useMutation') + 2000);
    expect(mutSrc).toMatch(/\/api\/pharmacy-module\/dispensing/);
    expect(mutSrc).toMatch(/prescription_line_id:\s*created\.pharmacy_line_id/);
    expect(mutSrc).toMatch(/from_location_id:\s*data\.location_id/);
  });

  test('a dispense failure does not roll back or hide the successful prescription', () => {
    const mutSrc = src.slice(src.indexOf('const rxMut = useMutation'), src.indexOf('const rxMut = useMutation') + 2000);
    // The dispense call is awaited for its own error toast, but the outer
    // mutationFn does not re-throw on a failed dispense — the prescription
    // POST already resolved successfully above it.
    expect(mutSrc).toMatch(/if \(!dr\.ok\)/);
    expect(mutSrc).not.toMatch(/if \(!dr\.ok\)[\s\S]{0,80}throw/);
  });
});
