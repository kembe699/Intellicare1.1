/**
 * Standard prescribing frequencies, and how a dispensed quantity follows from one.
 *
 * Frequency used to be a free-text box, so it was usually left empty — which is
 * why prescriptions came back with `frequency: null` and a quantity someone had
 * typed by hand. Both the pharmacist and the patient need the frequency to be
 * unambiguous, and the quantity to actually match it.
 *
 * The arithmetic every prescriber uses:
 *
 *     quantity = dose per administration x administrations per day x days
 *
 * e.g. 1 tablet TDS for 5 days = 1 x 3 x 5 = 15 tablets.
 *
 * `perDay` is what makes that computable. Two cases deliberately have no
 * `perDay` and must never be auto-calculated:
 *
 *   - PRN (as needed): the whole point is that the count isn't known up front,
 *     so the prescriber supplies a quantity to dispense.
 *   - STAT (once, immediately): a single administration, not a daily course.
 *
 * Alternate-day and weekly dosing are fractional per day; the total is rounded
 * up, because you cannot dispense part of a tablet and a short supply means the
 * patient runs out before the course ends.
 */
export interface FrequencyOption {
  /** Stored on the prescription line, and what the pharmacist reads. */
  code: string;
  /** Plain-language meaning, shown beside the code and used for searching. */
  label: string;
  /** Administrations per day; undefined where a quantity cannot be derived. */
  perDay?: number;
  /** Latin/rota abbreviations prescribers may search by. */
  aliases?: string[];
}

export const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { code: 'OD',    label: 'Once daily',                 perDay: 1,    aliases: ['qd', 'daily', 'once', 'od'] },
  { code: 'BD',    label: 'Twice daily',                perDay: 2,    aliases: ['bid', 'bd', 'twice'] },
  { code: 'TDS',   label: 'Three times daily',          perDay: 3,    aliases: ['tid', 'tds', 'thrice', 'three'] },
  { code: 'QDS',   label: 'Four times daily',           perDay: 4,    aliases: ['qid', 'qds', 'four'] },
  { code: '5x/day', label: 'Five times daily',          perDay: 5,    aliases: ['five'] },
  { code: 'Q4H',   label: 'Every 4 hours',              perDay: 6,    aliases: ['q4h', '4 hourly', 'four hourly'] },
  { code: 'Q6H',   label: 'Every 6 hours',              perDay: 4,    aliases: ['q6h', '6 hourly', 'six hourly'] },
  { code: 'Q8H',   label: 'Every 8 hours',              perDay: 3,    aliases: ['q8h', '8 hourly', 'eight hourly'] },
  { code: 'Q12H',  label: 'Every 12 hours',             perDay: 2,    aliases: ['q12h', '12 hourly'] },
  { code: 'Mane',  label: 'In the morning',             perDay: 1,    aliases: ['morning', 'am', 'mane'] },
  { code: 'Nocte', label: 'At night',                   perDay: 1,    aliases: ['night', 'nocte', 'pm', 'bedtime'] },
  { code: 'AC',    label: 'Before meals (3 x daily)',   perDay: 3,    aliases: ['ac', 'before meals', 'before food'] },
  { code: 'PC',    label: 'After meals (3 x daily)',    perDay: 3,    aliases: ['pc', 'after meals', 'after food'] },
  { code: 'EOD',   label: 'Every other day',            perDay: 0.5,  aliases: ['eod', 'alternate', 'alternate days'] },
  { code: 'Weekly', label: 'Once a week',               perDay: 1 / 7, aliases: ['weekly', 'once weekly'] },
  { code: 'PRN',   label: 'As needed (no fixed count)', aliases: ['prn', 'as needed', 'as required'] },
  { code: 'STAT',  label: 'Immediately, once only',     perDay: undefined, aliases: ['stat', 'once only', 'immediately'] },
];

export const findFrequency = (code?: string | null): FrequencyOption | undefined =>
  code ? FREQUENCY_OPTIONS.find((f) => f.code.toLowerCase() === code.toLowerCase()) : undefined;

/** Free-text search across code, meaning and abbreviations. */
export function searchFrequencies(query: string): FrequencyOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return FREQUENCY_OPTIONS;
  return FREQUENCY_OPTIONS.filter(
    (f) =>
      f.code.toLowerCase().includes(q) ||
      f.label.toLowerCase().includes(q) ||
      f.aliases?.some((a) => a.includes(q))
  );
}

/**
 * quantity = dose x perDay x days, rounded up.
 *
 * Returns null when the total is not derivable — PRN, STAT, or a missing
 * duration — so the caller leaves the prescriber's own quantity alone rather
 * than overwriting it with a guess.
 */
export function calculateQuantity(
  dosePerAdministration: number,
  frequencyCode?: string | null,
  durationDays?: number | null
): number | null {
  const freq = findFrequency(frequencyCode);
  if (!freq?.perDay) return null;
  const dose = Number(dosePerAdministration);
  const days = Number(durationDays);
  if (!Number.isFinite(dose) || dose <= 0) return null;
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.ceil(dose * freq.perDay * days);
}

/**
 * What to call one dose on screen and on printouts. A drug stocked as a
 * pack (unit_of_measure "Strip") needs its own dose_unit_label ("Tablet")
 * set in Item Master, or a dose count gets wrongly labeled with the pack's
 * name — this is the fix for that, not just cosmetic: calculateQuantity()
 * always returns a dose-unit count, never a pack count.
 */
export function doseUnitLabel(drug?: { dose_unit_label?: string | null; unit_of_measure?: string | null } | null): string {
  return drug?.dose_unit_label || drug?.unit_of_measure || 'tablet';
}

/**
 * Converts a dose-unit quantity (tablets/mL — what calculateQuantity()
 * computes) into the item's pack-equivalent (strips/bottles/tubes/vials —
 * what stock_on_hand/quantity_on_hand is actually tracked in), for
 * client-side stock checks before submitting. units_per_pack defaults to 1
 * (no conversion) for any item that hasn't had a real pack size configured.
 */
export function packEquivalent(doseQty: number, drug?: { units_per_pack?: number | string | null } | null): number {
  const unitsPerPack = Number(drug?.units_per_pack) || 1;
  return doseQty / unitsPerPack;
}

/**
 * A bill line for a drug prescribed in doses. Stock, cost and selling price are
 * per PACK (a strip of units_per_pack tablets), so the line keeps the dose count
 * the patient sees (quantity) and the pack equivalent the money and stock run on
 * (packQuantity): total = pack price × packs. Billing doses × pack price
 * overcharged by the pack size (24 Coartem tablets billed as 24 packs).
 */
export function drugBillLine(opts: {
  drugId: string; drugName: string; doses: number; packPrice: number;
  unitsPerPack?: number | string | null; currency?: string;
}) {
  const upp = Number(opts.unitsPerPack) || 1;
  const packs = opts.doses / upp;
  const total = Math.round(opts.packPrice * packs * 100) / 100;
  return {
    serviceId: opts.drugId, serviceName: opts.drugName, quantity: opts.doses, packQuantity: packs,
    unitPrice: opts.doses ? Math.round((total / opts.doses) * 10000) / 10000 : 0, totalPrice: total,
    category: 'Pharmacy / Inventory', ...(opts.currency ? { currency: opts.currency } : {}),
  };
}

/** "1 tablet three times daily for 5 days" — the sig, for labels and printouts. */
export function describeDosage(
  dose: number | string | null | undefined,
  unit: string | null | undefined,
  frequencyCode?: string | null,
  durationDays?: number | null
): string {
  const freq = findFrequency(frequencyCode);
  const parts: string[] = [];
  if (dose) parts.push(`${dose}${unit ? ` ${unit}` : ''}`);
  if (freq) parts.push(freq.label.toLowerCase());
  else if (frequencyCode) parts.push(frequencyCode);
  if (durationDays) parts.push(`for ${durationDays} day${Number(durationDays) === 1 ? '' : 's'}`);
  return parts.join(' ') || '—';
}
