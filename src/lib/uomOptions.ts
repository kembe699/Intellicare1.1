// The full unit-of-measure catalog — shared so every place a UOM is picked
// (Item Master, Purchase Requisitions, Purchase Orders) offers the same
// complete list instead of each page keeping its own partial copy.
export const UOM_OPTIONS = [
  { value: 'Tab', label: 'Tablet(s)' }, { value: 'Cap', label: 'Capsule(s)' },
  { value: 'Amp', label: 'Ampoule(s)' }, { value: 'Vial', label: 'Vial(s)' },
  { value: 'Bottle', label: 'Bottle(s)' }, { value: 'Sachet', label: 'Sachet(s)' },
  { value: 'Tube', label: 'Tube(s)' }, { value: 'Syringe', label: 'Syringe(s)' },
  { value: 'mL', label: 'Millilitre(s)' }, { value: 'L', label: 'Litre(s)' },
  { value: 'g', label: 'Gram(s)' }, { value: 'mg', label: 'Milligram(s)' },
  { value: 'mcg', label: 'Microgram(s)' }, { value: 'IU', label: 'International Units' },
  { value: 'U', label: 'Units' }, { value: 'Each', label: 'Each' },
  { value: 'Box', label: 'Box(es)' }, { value: 'Pack', label: 'Pack(s)' },
  { value: 'Strip', label: 'Strip(s)' }, { value: 'Dose', label: 'Dose(s)' },
  { value: 'Patch', label: 'Patch(es)' }, { value: 'Supp', label: 'Suppository/Suppositories' },
  { value: 'Drop', label: 'Drop(s)' }, { value: 'Puff', label: 'Puff(s) / Inhalation' },
  { value: 'Roll', label: 'Roll(s)' }, { value: 'Pair', label: 'Pair(s)' },
  { value: 'Set', label: 'Set(s)' }, { value: 'Piece', label: 'Piece(s)' },
];
