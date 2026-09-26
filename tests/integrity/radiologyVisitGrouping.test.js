/**
 * The Radiology queue used to show one row per exam request. dpoc asked for
 * it to group by patient/visit instead (one row per visit, with a request
 * count), with search/filter/pagination/CSV export, and for the detail page
 * (still at the same /radiology/requests/:id URL) to show every exam
 * requested in that visit, not just the one whose id is in the URL.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('GET /api/radiology/visits — grouped queue data', () => {
  const src = read('src/server/routes/radiology.js');
  const section = src.slice(src.indexOf("router.get('/visits'"), src.indexOf("router.get('/requests/:id/visit'"));

  test('is gated on radiology.read, same as the rest of the read-only radiology endpoints', () => {
    const header = src.slice(src.indexOf("router.get('/visits'"), src.indexOf("router.get('/visits'") + 60);
    expect(header).toMatch(/authorize\('radiology\.read'\)/);
  });

  test('groups by participant + order (or the request itself when there is no order), not by exam', () => {
    expect(section).toMatch(/GROUP BY rr\.participant_id, COALESCE\(rr\.order_id, rr\.id\)/);
  });

  test('reports a request count and a per-status breakdown for the badge/filter', () => {
    expect(section).toMatch(/COUNT\(\*\) AS request_count/);
    expect(section).toMatch(/COUNT\(\*\) FILTER \(WHERE rr\.status = 'pending'\) AS pending_count/);
    expect(section).toMatch(/COUNT\(\*\) FILTER \(WHERE rr\.status = 'in_progress'\) AS in_progress_count/);
    expect(section).toMatch(/COUNT\(\*\) FILTER \(WHERE rr\.status = 'completed'\) AS completed_count/);
  });

  test('urgent is true for the visit if any of its requests is urgent', () => {
    expect(section).toMatch(/BOOL_OR\(rr\.urgent\) AS urgent/);
  });
});

describe('GET /api/radiology/requests/:id/visit — full visit detail', () => {
  const src = read('src/server/routes/radiology.js');
  const section = src.slice(src.indexOf("router.get('/requests/:id/visit'"), src.indexOf("router.get('/requests/:id',"));

  test('is gated on radiology.read', () => {
    const header = src.slice(src.indexOf("router.get('/requests/:id/visit'"), src.indexOf("router.get('/requests/:id/visit'") + 70);
    expect(header).toMatch(/authorize\('radiology\.read'\)/);
  });

  test('resolves the visit key from the given id before fetching siblings, using the same COALESCE(order_id, id) rule as /visits', () => {
    expect(section).toMatch(/COALESCE\(order_id, id\) AS visit_key FROM radiology_requests WHERE id = :id/);
    expect(section).toMatch(/COALESCE\(rr\.order_id, rr\.id\) = :visitKey/);
  });

  test('404s when the anchor id does not exist rather than silently returning an empty visit', () => {
    expect(section).toMatch(/if \(!anchor\) return res\.status\(404\)/);
  });

  test('returns every matching request, oldest first, under a requests array', () => {
    expect(section).toMatch(/ORDER BY rr\.request_date ASC/);
    expect(section).toMatch(/res\.json\(\{ requests: rows \}\)/);
  });
});

describe('RadiologyQueue.tsx renders the grouped visit list with search/filter/export/pagination', () => {
  const src = read('src/pages/radiology/RadiologyQueue.tsx');

  test('fetches the grouped /visits endpoint, not the flat /requests list', () => {
    expect(src).toMatch(/\/api\/radiology\/visits/);
  });

  test('the table is searchable, exportable, and paginated', () => {
    expect(src).toMatch(/searchable/);
    expect(src).toMatch(/exportable/);
    expect(src).toMatch(/exportFileName="radiology-requests"/);
    expect(src).toMatch(/pagination=\{\{ enabled: true/);
  });

  test('has a status filter that narrows the data passed into the table', () => {
    expect(src).toMatch(/statusFilter/);
    expect(src).toMatch(/const filteredVisits = statusFilter === 'all' \? visits : visits\.filter/);
  });

  test('shows a Requests column with the per-visit count', () => {
    expect(src).toMatch(/header: 'Requests'/);
  });

  test('clicking a row still navigates to the same /radiology/requests/:id URL shape', () => {
    expect(src).toMatch(/navigate\(`\/radiology\/requests\/\$\{v\.id\}`\)/);
  });
});

describe('RadiologyRequestDetail.tsx shows every request in the visit, not just one', () => {
  const src = read('src/pages/radiology/RadiologyRequestDetail.tsx');

  test('fetches the whole-visit endpoint keyed off the URL id', () => {
    expect(src).toMatch(/\/api\/radiology\/requests\/\$\{id\}\/visit/);
  });

  test('renders one RequestCard per request returned, each independently confirmable/reportable', () => {
    expect(src).toMatch(/requests\.map\(\(r\) => \(\s*<RequestCard key=\{r\.id\}/);
  });

  test('each RequestCard keeps its own report draft state, so editing one exam cannot clobber another', () => {
    const cardSrc = src.slice(src.indexOf('function RequestCard'), src.indexOf('export default function RadiologyRequestDetail'));
    expect(cardSrc).toMatch(/useState\(request\.report_html \|\| ''\)/);
  });

  test('a shared patient/visit header is shown once, not duplicated per exam', () => {
    expect(src).toMatch(/exam\{requests\.length === 1 \? '' : 's'\} requested/);
  });
});
