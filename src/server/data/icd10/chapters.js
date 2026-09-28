// The 21 official ICD-10-CM chapters (stable across revision years) plus the
// "special purposes" range CMS added later (U00-U85, e.g. COVID-19 codes).
// Ranges are compared as plain strings against a 3-character category code
// (e.g. "B54", "S00", "O9A") — every boundary here is exactly 3 characters,
// so lexicographic string comparison matches ICD-10's own letter+2-digit
// ordering (including alpha-tailed boundaries like "O9A").
const CHAPTERS = [
  { start: 'A00', end: 'B99', name: 'Certain infectious and parasitic diseases' },
  { start: 'C00', end: 'D49', name: 'Neoplasms' },
  { start: 'D50', end: 'D89', name: 'Diseases of the blood and blood-forming organs and certain disorders involving the immune mechanism' },
  { start: 'E00', end: 'E89', name: 'Endocrine, nutritional and metabolic diseases' },
  { start: 'F01', end: 'F99', name: 'Mental, Behavioral and Neurodevelopmental disorders' },
  { start: 'G00', end: 'G99', name: 'Diseases of the nervous system' },
  { start: 'H00', end: 'H59', name: 'Diseases of the eye and adnexa' },
  { start: 'H60', end: 'H95', name: 'Diseases of the ear and mastoid process' },
  { start: 'I00', end: 'I99', name: 'Diseases of the circulatory system' },
  { start: 'J00', end: 'J99', name: 'Diseases of the respiratory system' },
  { start: 'K00', end: 'K95', name: 'Diseases of the digestive system' },
  { start: 'L00', end: 'L99', name: 'Diseases of the skin and subcutaneous tissue' },
  { start: 'M00', end: 'M99', name: 'Diseases of the musculoskeletal system and connective tissue' },
  { start: 'N00', end: 'N99', name: 'Diseases of the genitourinary system' },
  { start: 'O00', end: 'O9A', name: 'Pregnancy, childbirth and the puerperium' },
  { start: 'P00', end: 'P96', name: 'Certain conditions originating in the perinatal period' },
  { start: 'Q00', end: 'Q99', name: 'Congenital malformations, deformations and chromosomal abnormalities' },
  { start: 'R00', end: 'R99', name: 'Symptoms, signs and abnormal clinical and laboratory findings, not elsewhere classified' },
  { start: 'S00', end: 'T88', name: 'Injury, poisoning and certain other consequences of external causes' },
  { start: 'U00', end: 'U85', name: 'Codes for special purposes' },
  { start: 'V00', end: 'Y99', name: 'External causes of morbidity' },
  { start: 'Z00', end: 'Z99', name: 'Factors influencing health status and contact with health services' },
];

function chapterForCategory(categoryCode) {
  const found = CHAPTERS.find((c) => categoryCode >= c.start && categoryCode <= c.end);
  return found ? found.name : null;
}

module.exports = { CHAPTERS, chapterForCategory };
