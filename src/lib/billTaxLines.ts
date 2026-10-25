/**
 * A taxed bill line has a companion tax line (server: utils/billTax.js):
 *   { isTax: true, taxFor: <item's line_id> }
 * Paying, selecting or voiding the item takes its tax line with it.
 */
export interface TaxableLine { line_id?: string; isTax?: boolean; taxFor?: string; isVoided?: boolean }

/** Index of the line paired with services[i] (its tax line, or the item a tax line belongs to), or -1. */
export function pairedLineIndex(services: TaxableLine[], i: number): number {
  const s = services[i];
  if (!s) return -1;
  if (s.isTax) return s.taxFor ? services.findIndex((x) => !x.isTax && x.line_id === s.taxFor) : -1;
  return s.line_id ? services.findIndex((x) => x.isTax && !x.isVoided && x.taxFor === s.line_id) : -1;
}
