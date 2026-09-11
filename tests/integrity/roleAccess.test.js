/**
 * A page's route guard and the API guards behind it must agree.
 *
 * These drift silently and in the worst possible way. The patient picker reads
 * two registries and merges them; GET /api/lis/participants allowed admin,
 * reception, doctor and lab, but the dispensing page allowed pharmacy. On a
 * tenant whose people are all registered through the LIS, the pharmacy role got
 * a 403 for the only registry holding anyone and the picker rendered as empty —
 * a permission bug that looked exactly like "this facility has no patients".
 *
 * Nothing about that is visible in either file alone, so it is asserted here by
 * reading both: every role a page's ProtectedRoute admits must also be admitted
 * by the endpoints that page depends on.
 */
const fs = require('fs');
const path = require('path');
const { DEFAULT_ROLE_PRIVILEGES } = require('../../src/server/config/permissionsCatalog');

const root = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** `const Foo = lazyWithRetry(() => import('./pages/x/Foo'));` -> { Foo: 'src/pages/x/Foo.tsx' } */
function componentFiles(appSrc) {
  const out = {};
  const re = /const\s+(\w+)\s*=\s*(?:lazyWithRetry|lazy)\(\s*\(\)\s*=>\s*import\(['"]\.\/([^'"]+)['"]\)/g;
  let m;
  while ((m = re.exec(appSrc))) out[m[1]] = `src/${m[2]}.tsx`;
  return out;
}

/** `<ProtectedRoute allowedRoles={[...]}> <Foo />` -> { Foo: [roles] } */
function componentRoles(appSrc) {
  const out = {};
  const re = /allowedRoles=\{\[([^\]]*)\]\}[\s\S]{0,400}?<(\w+)\s*\/>/g;
  let m;
  while ((m = re.exec(appSrc))) {
    const roles = [...m[1].matchAll(/'([^']+)'/g)].map((r) => r[1]);
    out[m[2]] = [...new Set([...(out[m[2]] || []), ...roles])];
  }
  return out;
}

/** The role array a privilege key currently grants, per the real catalog
 * (src/server/config/permissionsCatalog.js) that authorize() actually reads
 * from now — dynamic per-tenant DB grants beyond this initial seed are real
 * and expected to diverge over time, but the seed itself must never
 * regress below what these contracts require. */
function roleConst(_src, key) {
  return DEFAULT_ROLE_PRIVILEGES[key] || null;
}

describe('Route guards agree with API guards', () => {
  const appSrc = read('src/App.tsx');
  const files = componentFiles(appSrc);
  const roles = componentRoles(appSrc);

  test('App.tsx is parseable and guarded', () => {
    expect(Object.keys(files).length).toBeGreaterThan(20);
    expect(Object.keys(roles).length).toBeGreaterThan(20);
  });

  /** Roles admitted by every page whose source matches `usesFeature`. */
  const rolesNeedingFeature = (usesFeature) => {
    const needed = new Set();
    for (const [component, file] of Object.entries(files)) {
      const full = path.join(root, file);
      if (!fs.existsSync(full)) continue;
      if (!usesFeature(fs.readFileSync(full, 'utf8'))) continue;
      (roles[component] || []).forEach((r) => needed.add(r));
    }
    return [...needed];
  };

  // Each entry: what a page has to be able to do, and the authorize() list the
  // endpoint behind it uses. A role that can reach the page must be in the list.
  const CONTRACTS = [
    {
      what: 'read the patient directory',
      usesFeature: (src) => /fetchPatientDirectory/.test(src),
      constant: 'lis.participants.read',
    },
    {
      what: 'register a walk-in patient',
      usesFeature: (src) => /authFetch\('\/api\/lis\/participants',\s*\{\s*\n?\s*method: 'POST'/.test(src),
      constant: 'lis.participants.create',
    },
  ];

  const lisSrc = read('src/server/routes/lisModule.js');

  test.each(CONTRACTS)('every role that can $what is permitted to', ({ usesFeature, constant }) => {
    const needed = rolesNeedingFeature(usesFeature);
    expect(needed.length).toBeGreaterThan(0);

    const allowed = roleConst(lisSrc, constant);
    expect(allowed).not.toBeNull();

    const missing = needed.filter((r) => !allowed.includes(r));
    // Reported as an object so a failure names the offending roles directly.
    expect({ constant, missing, needed, allowed }).toEqual(
      expect.objectContaining({ missing: [] })
    );
  });

  test('GET /api/lis/participants uses the shared read privilege, not an inline one', () => {
    const src = read('src/server/routes/lisModule.js');
    expect(src).toMatch(/router\.get\('\/participants',\s*authorize\('lis\.participants\.read'\)/);
  });

  test('writing to the participant registry stays restricted', () => {
    const src = read('src/server/routes/lisModule.js');
    // Widening read access must not have widened writes.
    expect(src).toMatch(/router\.put\('\/participants\/:id',\s*authorize\('lis\.registration\.write'\)/);
  });
});

describe('New users cannot be stranded on a dead clinic', () => {
  const usersSrc = read('src/server/routes/users.js');

  test('the hardcoded single-tenant clinic name map is gone', () => {
    // clinicMap resolved 'IntelliCare' -> 1 on every tenant, so users created
    // through the UI landed on clinic 1 regardless of where the tenant's data
    // lived. It may survive only in explanatory comments.
    const code = usersSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/clinicMap\s*=/);
    expect(code).not.toMatch(/clinicMap\[/);
  });

  test('clinic is resolved from the tenant, not taken on trust from the client', () => {
    expect(usersSrc).toMatch(/resolveTenantClinicId/);
    expect(usersSrc).toMatch(/clinicExists/);
    expect(usersSrc).toMatch(/checkUserCanSeeData/);
  });

  test('the create-user form no longer posts a clinic name', () => {
    const form = read('src/pages/setup/Security.tsx');
    expect(form).not.toMatch(/clinic:\s*createFormData\.clinic\s*\|\|\s*'IntelliCare'/);
  });
});

describe('Patient directory is fetched in one place', () => {
  test('no page hand-rolls the two-registry merge any more', () => {
    const pages = [
      'src/pages/pharmacyModule/DispensingWorkflow.tsx',
      'src/pages/pharmacyModule/PrescriptionManagement.tsx',
      'src/pages/PatientsBill.tsx',
      'src/pages/ProformaInvoice.tsx',
    ];
    for (const p of pages) {
      const src = read(p);
      expect(src).toMatch(/fetchPatientDirectory/);
      // The old shape silently skipped a failed half; it must not come back.
      // Only the GET merge is forbidden — the walk-in POST is legitimate.
      expect(src).not.toMatch(/authFetch\('\/api\/lis\/participants',\s*\{\s*credentials/);
    }
  });

  test('a registry that fails to load is reported, not silently dropped', () => {
    const src = read('src/lib/patientDirectory.ts');
    expect(src).toMatch(/failed/);
    expect(src).toMatch(/403/);
  });
});

describe('Pharmacy can complete a dispensing sale', () => {
  const bills = read('src/server/routes/patientBills.js');

  // Which privilege key a given authorize() call site resolves to, then what
  // roles that key currently grants per the seed catalog — the two-step
  // replaces the old regex-scrape of a local role array, since the array no
  // longer lives in this file at all.
  const guardFor = (routeRe) => (bills.match(routeRe) || [])[1] || null;
  const rolesFor = (key) => DEFAULT_ROLE_PRIVILEGES[key] || null;

  // "Save Payment & Dispense" takes the money and hands over the medicine in one
  // step. Pharmacy could raise the charge and dispense but not record the
  // payment, so the flow died at the last click with "Insufficient permissions".
  test('pharmacy may record a payment against a bill', () => {
    const guard = guardFor(/router\.post\('\/:billId\/payments',\s*authorize\('([\w.]+)'\)/);
    expect(guard).toBeTruthy();
    expect(rolesFor(guard)).toContain('pharmacy');
  });

  // Taking money is not the same as changing what is owed. Widening the shared
  // privilege would have handed pharmacy bill editing and line voiding too,
  // which is how a narrow permission fix quietly becomes a broad one.
  test('pharmacy still may not edit a bill or void a line off one', () => {
    for (const routeRe of [
      /router\.put\('\/:billId',\s*authorize\('([\w.]+)'\)/,
      /router\.post\('\/:billId\/void-item',\s*authorize\('([\w.]+)'\)/,
    ]) {
      const guard = guardFor(routeRe);
      expect(guard).toBeTruthy();
      expect(rolesFor(guard)).not.toContain('pharmacy');
    }
  });

  // A non-credit payment is rejected without an open shift, so the ability to
  // collect is useless — and the cash untracked — unless pharmacy can open one.
  test('pharmacy can open the cashier shift its payments are recorded against', () => {
    const cashier = read('src/server/routes/cashier.js');
    const m = cashier.match(/router\.post\('\/start-shift',\s*authorize\('([\w.]+)'\)/);
    expect(m).toBeTruthy();
    expect(rolesFor(m[1])).toContain('pharmacy');
  });
});

describe('Pharmacy sees the work it did', () => {
  // Reads filter on branch_id and an admin bypasses that filter, so a row written
  // without one is visible to admins and to nobody else. Prescriptions and
  // dispensing records were being created with branch_id NULL: the pharmacist who
  // dispensed a drug could not find it in History, and the prescriptions list was
  // empty for the very role the page exists for — while an admin on the same
  // screen saw everything and could not reproduce it.
  const pharmacy = read('src/server/routes/pharmacyModule.js');

  test('a new prescription is stamped with a branch', () => {
    const insert = pharmacy.slice(pharmacy.indexOf('INSERT INTO pharmacy_prescriptions'));
    expect(insert.slice(0, 400)).toMatch(/branch_id/);
    expect(insert.slice(0, 1400)).toMatch(/branchId:/);
  });

  test('a dispensing record is stamped with a branch', () => {
    const insert = pharmacy.slice(pharmacy.indexOf('INSERT INTO dispensing_records'));
    expect(insert.slice(0, 400)).toMatch(/branch_id/);
    expect(insert.slice(0, 1800)).toMatch(/branchId:/);
  });

  test('an automatically dispensed record inherits the prescription branch', () => {
    // The automatic path writes the same table and would otherwise reintroduce
    // exactly the rows this fixes.
    const auto = read('src/server/services/autoDispense.js');
    const insert = auto.slice(auto.indexOf('INSERT INTO dispensing_records'));
    expect(insert.slice(0, 400)).toMatch(/branch_id/);
    expect(auto).toMatch(/branchId: line\.branch_id/);
    // It can only inherit what it selected.
    expect(auto).toMatch(/p\.branch_id/);
  });

  test('those tables are still filtered by branch on read', () => {
    // The stamp only matters because reads are scoped; if that ever stopped,
    // the fix above would be silently pointless.
    expect(pharmacy).toMatch(/pp\.branch_id = :rxBranchId/);
    expect(pharmacy).toMatch(/dr\.branch_id = :branchId/);
  });
});
