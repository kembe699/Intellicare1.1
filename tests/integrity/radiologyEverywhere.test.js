/**
 * Two follow-ups to the (previously dpoc-only) Radiology module:
 * 1. Visit Summary now shows and prints a patient's radiology requests/reports
 *    for that visit — it was explicitly left untouched by the original
 *    dpoc rollout, so this is a deliberate, later addition, not a slip.
 * 2. The Radiology module itself (Sidebar link, exam-types fetch, the
 *    ordering picker) is no longer dpoc-only — every tenant's admin/doctor/lab
 *    already has radiology.read/write granted (see ensurePrivilegesCatalog),
 *    so only the tenant *gates* needed removing, not the privileges.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('Radiology module is no longer dpoc-only', () => {
  test('Sidebar.tsx no longer gates the Radiology link by tenantCode', () => {
    const src = read('src/components/layout/Sidebar.tsx');
    expect(src).toMatch(/label: 'Radiology', href: '\/radiology', icon: Scan, privilege: 'radiology\.read' \}/);
    expect(src).not.toMatch(/tenantOnly/);
  });

  test("the nav filter no longer checks a per-item tenant gate", () => {
    const src = read('src/components/layout/Sidebar.tsx');
    expect(src).toMatch(/const filteredNavItems = navItems\.filter\(item => hasPrivilege\(item\.privilege\)\);/);
  });
});

describe('Visit Summary shows the visit\'s radiology requests and reports', () => {
  const src = read('src/pages/lis/LISTestOrders.tsx');

  test('opening a visit summary fetches its radiology by order_id, independent of the lab-results fetch', () => {
    const fnSrc = src.slice(src.indexOf('const openVisitSummary'), src.indexOf('const fetchPharmacyDrugs'));
    expect(fnSrc).toMatch(/\/api\/radiology\/requests\?order_id=\$\{summary\.order_id\}/);
    // Must run before the early return for "no ready lab tests", not after it
    const radiologyFetchIndex = fnSrc.indexOf('/api/radiology/requests');
    const earlyReturnIndex = fnSrc.indexOf('if (readyTests.length === 0)');
    expect(radiologyFetchIndex).toBeGreaterThan(-1);
    expect(earlyReturnIndex).toBeGreaterThan(-1);
    expect(radiologyFetchIndex).toBeLessThan(earlyReturnIndex);
  });

  test('the on-screen visit summary renders a Radiology section with the exam and its completed report', () => {
    const sectionIndex = src.indexOf('Radiology ({summaryRadiology.length})');
    expect(sectionIndex).toBeGreaterThan(-1);
    const section = src.slice(sectionIndex, sectionIndex + 2500);
    expect(section).toMatch(/dangerouslySetInnerHTML=\{\{ __html: r\.report_html \|\| '' \}\}/);
    expect(section).toMatch(/navigate\(`\/radiology\/requests\/\$\{r\.id\}`\)/);
  });

  test('printing the visit summary includes a Radiology table plus the full report text for completed exams', () => {
    const fnSrc = src.slice(src.indexOf('const handlePrintSummary'), src.indexOf('const handlePrint = async'));
    expect(fnSrc).toMatch(/const radiologyHTML = summaryRadiology\.length > 0/);
    expect(fnSrc).toMatch(/filter\(\(r: any\) => r\.status === 'completed'\)/);
    expect(fnSrc).toMatch(/radiologyHTML,\s*\n\s*docTemplate\.buildSignatures/);
  });
});

describe('GET /api/radiology/requests supports filtering by order_id for Visit Summary', () => {
  const src = read('src/server/routes/radiology.js');
  const section = src.slice(src.indexOf("router.get('/requests', authorize"), src.indexOf("router.get('/visits'"));

  test('accepts an order_id query param and scopes the WHERE clause with it', () => {
    expect(section).toMatch(/const \{ status, order_id, participant_id: participantId \} = req\.query;/);
    expect(section).toMatch(/AND rr\.order_id = :orderId/);
  });

  test('also accepts a participant_id query param, for a patient\'s full radiology history', () => {
    expect(section).toMatch(/AND rr\.participant_id = :participantId/);
  });

  test('also selects report_html and the confirm/report audit fields the visit summary needs to render', () => {
    expect(section).toMatch(/rr\.report_html/);
    expect(section).toMatch(/rr\.confirmed_by_name, rr\.confirmed_at, rr\.reported_by_name, rr\.reported_at/);
  });
});
