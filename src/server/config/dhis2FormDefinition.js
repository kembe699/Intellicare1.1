/**
 * DHIS2 Monthly HMIS Facility Report — form definition.
 *
 * Pure data, no functions. This is the ONE file to edit when the real South
 * Sudan MoH form arrives — the backend (reportDhis2.js) computes against it
 * and the frontend (Dhis2Report.tsx) renders sections A-H purely by
 * iterating whatever GET /api/reports-v2/dhis2/definition returns, with no
 * hardcoded per-section JSX. Kept function-free on purpose: this file is
 * required directly by the backend, but the frontend only ever sees it as
 * JSON over the API (Vite cannot import a CommonJS Node module, and the
 * frontend must not duplicate matching/bucketing logic anyway).
 *
 * Per-branch overrides to the lab/inventory mappings and keyword lists live
 * in the `dhis2_mappings` table (see reportDhis2.js) — what's here is only
 * the seed default.
 */

const AGE_BANDS = [
  { id: 'u5', label: '<5', maxYears: 5 },
  { id: 'ge5', label: '≥5', minYears: 5 },
];

// Every age/sex-bucketed row (sections A and B) uses this same column set.
// "unknown" covers a visit whose patient has a missing date_of_birth or
// gender — never guessed into a band — and IS included in total.
const AGE_SEX_COLUMNS = [
  { id: 'u5m', label: '<5 M' },
  { id: 'u5f', label: '<5 F' },
  { id: 'ge5m', label: '≥5 M' },
  { id: 'ge5f', label: '≥5 F' },
  { id: 'unknown', label: 'Unknown Age/Sex' },
  { id: 'total', label: 'Total' },
];

// Negation words the diagnosis matcher must ignore a keyword hit near —
// checked both before AND after the matched keyword (e.g. "rule out
// malaria" vs "malaria negative"/"malaria ruled out").
const NEGATION_WORDS = [
  'rule out', 'ruled out', 'r/o', 'ro:', '?', 'no ', 'not ', 'negative',
  'denies', 'denied', 'nil', 'absent',
];
const NEGATION_WINDOW_CHARS = 25;

const SECTIONS = {
  A: {
    id: 'A',
    title: 'Outpatient Attendance',
    type: 'attendance',
    columns: AGE_SEX_COLUMNS,
    rows: [
      { id: 'new', label: 'New attendance' },
      { id: 'reattendance', label: 'Re-attendance' },
      { id: 'total', label: 'Total', isTotal: true },
    ],
    // Data-driven so it can change without touching code, per the request.
    attendanceRule: {
      description: "New = the patient's first outpatient visit (lis_test_orders row) in the calendar year; any later visit in the same year is re-attendance.",
    },
  },

  B: {
    id: 'B',
    title: 'Outpatient Morbidity (New Cases)',
    type: 'morbidity',
    columns: AGE_SEX_COLUMNS,
    warningText: 'Coded from ICD-10 diagnoses where the visit has one; matched by keyword from free-text/custom diagnoses otherwise. Review before submitting.',
    negationWords: NEGATION_WORDS,
    negationWindowChars: NEGATION_WINDOW_CHARS,
    rows: [
      {
        id: 'malaria_confirmed', label: 'Malaria (confirmed)',
        icd10: ['B54'], keywords: ['malaria'],
        // A malaria-diagnosed visit only lands here if the SAME visit has an
        // approved, positive result against one of these section-C row ids;
        // otherwise it falls through to malariaClinicalFallbackRowId below.
        confirmedByLabRowIds: ['malaria_rdt', 'malaria_microscopy'],
        malariaClinicalFallbackRowId: 'malaria_clinical',
      },
      {
        id: 'malaria_clinical', label: 'Malaria (clinical, not confirmed)',
        icd10: [], keywords: [],
        // Never matched directly — only ever populated as the fallback
        // target from malaria_confirmed above.
        isMalariaClinicalFallback: true,
      },
      { id: 'pneumonia_ari', label: 'Pneumonia/ARI', icd10: ['J18.9', 'J06.9'], keywords: ['pneumonia', 'ari', 'acute respiratory infection', 'chest infection'] },
      { id: 'awd', label: 'Acute watery diarrhoea', icd10: ['K59.1'], keywords: ['diarrhea', 'diarrhoea', 'awd', 'watery stool', 'watery diarrhoea'] },
      { id: 'bloody_diarrhoea', label: 'Bloody diarrhoea', icd10: ['A09'], keywords: ['bloody diarrhoea', 'bloody diarrhea', 'dysentery', 'blood in stool'] },
      { id: 'typhoid', label: 'Typhoid fever', icd10: ['A01.0'], keywords: ['typhoid'] },
      { id: 'intestinal_worms', label: 'Intestinal worms', icd10: ['B83.9'], keywords: ['worm', 'worms', 'helminth', 'ascariasis', 'intestinal parasite'] },
      { id: 'uti', label: 'Urinary tract infection', icd10: ['N39.0'], keywords: ['uti', 'urinary tract infection'] },
      { id: 'skin_infections', label: 'Skin infections', icd10: ['L98.9', 'L03.90', 'B86', 'L30.9', 'B49'], keywords: ['skin infection', 'scabies', 'cellulitis', 'dermatitis', 'fungal infection', 'ringworm'] },
      { id: 'eye_infections', label: 'Eye infections', icd10: ['H10.9'], keywords: ['conjunctivitis', 'eye infection', 'red eye'] },
      { id: 'sam', label: 'Severe acute malnutrition', icd10: ['E46'], keywords: ['severe acute malnutrition', 'sam', 'malnutrition'] },
      { id: 'sti', label: 'Sexually transmitted infections', icd10: ['A64'], keywords: ['sti', 'std', 'sexually transmitted'] },
      { id: 'injuries', label: 'Injuries', icd10: ['T14.90XA', 'T14.1', 'T30.0'], keywords: ['injury', 'injuries', 'trauma', 'wound', 'burn', 'fracture', 'gun shot', 'gunshot'] },
      { id: 'measles', label: 'Measles (suspected, notifiable)', icd10: [], keywords: ['measles'], isNotifiable: true },
      { id: 'no_diagnosis', label: 'No diagnosis recorded', isMeta: true },
      { id: 'other', label: 'All other diagnoses', isCatchAll: true },
      { id: 'total', label: 'Total', isTotal: true },
    ],
  },

  C: {
    id: 'C',
    title: 'Laboratory',
    type: 'laboratory',
    columns: [
      { id: 'tested', label: 'Tested' },
      { id: 'positive', label: 'Positive' },
      { id: 'pct_positive', label: '% positive' },
    ],
    rows: [
      { id: 'malaria_rdt', label: 'Malaria RDT', testNameKeywords: ['rdt', 'malaria rdt', 'rapid diagnostic'], positiveValues: ['positive', 'reactive', '+'] },
      { id: 'malaria_microscopy', label: 'Malaria microscopy', testNameKeywords: ['bffm', 'microscopy', 'blood film', 'mps'], positiveValues: ['positive', 'seen', '+', 'trophozoites', 'plasmodium'] },
      { id: 'hiv', label: 'HIV test', testNameKeywords: ['hiv'], positiveValues: ['positive', 'reactive'] },
      { id: 'syphilis', label: 'Syphilis (antenatal)', testNameKeywords: ['syphilis', 'vdrl', 'rpr'], positiveValues: ['positive', 'reactive'] },
    ],
  },

  D: {
    id: 'D',
    title: 'Maternal and Newborn Health',
    type: 'manual',
    note: 'Entered manually',
    rows: [
      { id: 'anc1', label: 'ANC 1st visit' },
      { id: 'anc4', label: 'ANC 4th visit' },
      { id: 'facility_deliveries', label: 'Facility deliveries' },
      { id: 'skilled_birth_attendant', label: 'Skilled birth attendant' },
      { id: 'live_births', label: 'Live births' },
      { id: 'stillbirths', label: 'Stillbirths' },
      { id: 'pnc_2days', label: 'Postnatal care within 2 days' },
      { id: 'maternal_deaths', label: 'Maternal deaths' },
    ],
  },

  E: {
    id: 'E',
    title: 'Immunisation (children under 1)',
    type: 'manual',
    note: 'Entered manually',
    rows: [
      { id: 'bcg', label: 'BCG' },
      { id: 'penta1', label: 'Penta 1' },
      { id: 'penta3', label: 'Penta 3' },
      { id: 'measles1', label: 'Measles 1' },
      { id: 'fully_immunised', label: 'Fully immunised' },
    ],
  },

  F: {
    id: 'F',
    title: 'Inpatient',
    type: 'inpatient',
    rows: [
      { id: 'admissions', label: 'Admissions' },
      { id: 'discharges', label: 'Discharges' },
      { id: 'deaths', label: 'Deaths' },
      { id: 'referred_out', label: 'Referred out' },
      { id: 'bed_days', label: 'Bed days' },
    ],
  },

  G: {
    id: 'G',
    title: 'Tracer Drugs and Supplies',
    type: 'tracer_drugs',
    columns: [
      { id: 'opening', label: 'Opening balance' },
      { id: 'received', label: 'Received' },
      { id: 'used', label: 'Used' },
      { id: 'closing', label: 'Closing balance' },
      { id: 'daysOutOfStock', label: 'Days out of stock' },
    ],
    // Default row -> inventory item name keywords. Overridable per-clinic
    // via dhis2_mappings once real item ids are picked in the settings
    // dialog — these keywords are only used to suggest a starting mapping.
    defaultItems: [
      { id: 'al', label: 'Artemether-lumefantrine', itemNameKeywords: ['artemether', 'lumefantrine', 'al 6x1', 'coartem'] },
      { id: 'amoxicillin_250', label: 'Amoxicillin 250 mg', itemNameKeywords: ['amoxicillin 250'] },
      { id: 'ors', label: 'ORS sachets', itemNameKeywords: ['ors', 'oral rehydration'] },
      { id: 'zinc_20', label: 'Zinc 20 mg', itemNameKeywords: ['zinc 20', 'zinc sulphate'] },
      { id: 'paracetamol_500', label: 'Paracetamol 500 mg', itemNameKeywords: ['paracetamol 500'] },
      { id: 'malaria_rdt_kits', label: 'Malaria RDT kits', itemNameKeywords: ['malaria rdt', 'rdt kit'] },
    ],
    receivedTransactionTypes: ['receipt'],
    usedTransactionTypes: ['dispense', 'usage', 'waste', 'damage'],
  },

  H: {
    id: 'H',
    title: 'Sign-off',
    type: 'signoff',
    fields: [
      { id: 'prepared_by', label: 'Prepared by', type: 'text' },
      { id: 'checked_by', label: 'Checked by (facility in-charge)', type: 'text' },
      { id: 'date_submitted_to_county', label: 'Date submitted to county', type: 'date' },
      { id: 'received_by', label: 'Received by (county HMIS officer)', type: 'text' },
      { id: 'date_entered_dhis2', label: 'Date entered into DHIS2', type: 'date' },
    ],
  },
};

// Header block — Facility name is derived from the branch, never editable
// here; everything else is editable per-branch via dhis2_branch_settings
// (the "Report settings" dialog).
const HEADER_FIELDS = [
  { id: 'state', label: 'State', editable: true },
  { id: 'county', label: 'County', editable: true },
  { id: 'payam', label: 'Payam', editable: true },
  { id: 'facility_name', label: 'Facility name', source: 'branch', editable: false },
  { id: 'facility_code', label: 'Facility code (DHIS2 org unit ID)', editable: true },
  { id: 'facility_type', label: 'Facility type', editable: true },
  { id: 'catchment_population', label: 'Catchment population', type: 'number', editable: true },
];

// Warnings only, never a hard block on save.
const VALIDATION_RULES = [
  { id: 'col_totals_match_row_totals', description: 'Column totals must equal row totals.' },
  { id: 'morbidity_not_exceed_attendance', description: 'Visits with at least one recorded diagnosis should not exceed total attendance (Section A total).' },
  { id: 'malaria_confirmed_vs_tests', description: 'Malaria (confirmed) should roughly match the number of positive malaria tests in Section C.' },
];

module.exports = {
  ageBands: AGE_BANDS,
  ageSexColumns: AGE_SEX_COLUMNS,
  negationWords: NEGATION_WORDS,
  negationWindowChars: NEGATION_WINDOW_CHARS,
  sections: SECTIONS,
  headerFields: HEADER_FIELDS,
  validationRules: VALIDATION_RULES,
};
