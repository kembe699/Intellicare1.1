/**
 * The proforma patient picker must use the fields the shared directory
 * actually returns.
 *
 * fetchPatientDirectory() (src/lib/patientDirectory.ts) returns DirectoryPerson
 * objects: { id, label, code, firstName, lastName, source }. ProformaInvoice.tsx
 * was migrated onto it but its search filter and its display code kept
 * referencing `first_name` / `last_name` — the snake_case shape of a raw
 * /api/patients row, not the shared type. Both fields are undefined on every
 * DirectoryPerson, so the search string was always "undefined undefined": no
 * search term ever matched, so the picker read as permanently empty ("No
 * matching patients") however many people the API actually returned — which
 * is why raising the API's row limit earlier in this same investigation did
 * not fix what the user was seeing.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('ProformaInvoice reads the patient fields that exist', () => {
  const directory = read('src/lib/patientDirectory.ts');
  const proforma = read('src/pages/ProformaInvoice.tsx');

  test('the shared DirectoryPerson type is camelCase, not the raw API row', () => {
    // The raw /api/patients row does have first_name/last_name — that is what
    // patientDirectory.ts reads to build a DirectoryPerson — but the exported
    // type consumers receive is camelCase. If this interface ever changes, the
    // checks below are testing the wrong shape.
    const iface = directory.slice(
      directory.indexOf('export interface DirectoryPerson'),
      directory.indexOf('export interface PatientDirectoryResult')
    );
    expect(iface).toMatch(/firstName\?:/);
    expect(iface).toMatch(/lastName\?:/);
    expect(iface).not.toMatch(/first_name/);
  });

  test('the page does not filter or render a DirectoryPerson by first_name/last_name', () => {
    expect(proforma).not.toMatch(/\bp\.first_name\b/);
    expect(proforma).not.toMatch(/\bp\.last_name\b/);
    expect(proforma).not.toMatch(/selectedPatient\.first_name/);
    expect(proforma).not.toMatch(/selectedPatient\.last_name/);
  });

  test('it filters and displays by .label, the field the directory provides', () => {
    expect(proforma).toMatch(/p\.label\?\.toLowerCase\(\)\.includes\(q\)/);
    expect(proforma).toMatch(/\{p\.label\}/);
    expect(proforma).toMatch(/\{selectedPatient\.label\}/);
    expect(proforma).toMatch(/patient_name: selectedPatient\.label/);
  });
});
