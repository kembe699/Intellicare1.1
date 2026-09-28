// Common local shorthand -> the words to also search for, so typing the
// abbreviation a doctor actually uses finds the right ICD-10 description
// even though the code's own text spells it out in full. Keys are matched
// case-insensitively as whole words in the search query; values are ORed
// into the text-search query alongside whatever was typed.
const ICD10_SYNONYMS = {
  uti: ['urinary tract infection'],
  pud: ['peptic ulcer'],
  htn: ['hypertension'],
  dm: ['diabetes mellitus'],
  rta: ['road traffic accident'],
  pid: ['pelvic inflammatory disease'],
  urti: ['upper respiratory tract infection'],
  age: ['gastroenteritis'],
  sam: ['severe acute malnutrition'],
  copd: ['chronic obstructive pulmonary disease'],
  cva: ['cerebrovascular accident', 'stroke'],
  mi: ['myocardial infarction'],
  chf: ['heart failure'],
  tb: ['tuberculosis'],
  std: ['sexually transmitted'],
  sti: ['sexually transmitted'],
  anc: ['antenatal'],
  pnc: ['postnatal'],
  uri: ['upper respiratory infection'],
  gerd: ['gastro esophageal reflux'],
};

module.exports = { ICD10_SYNONYMS };
