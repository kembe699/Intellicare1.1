/**
 * B1: ensureLineIds gives every service line a stable id, once, so void-item
 * and payment posting can identify "which line" without relying on array
 * position (which shifts whenever an earlier line is voided-and-removed or a
 * new one is added). See normalizeServices.js's own docstring for the full
 * rationale and the production bug class this closes.
 */
const { ensureLineIds } = require('../../src/server/utils/normalizeServices');

describe('ensureLineIds', () => {
  test('assigns a line_id to every element missing one', () => {
    const result = ensureLineIds([
      { serviceName: 'Consultation', totalPrice: 5000 },
      { serviceName: 'Malaria Test', totalPrice: 8000 },
    ]);
    expect(result).toHaveLength(2);
    for (const line of result) {
      expect(typeof line.line_id).toBe('string');
      expect(line.line_id.length).toBeGreaterThan(0);
    }
    expect(result[0].line_id).not.toBe(result[1].line_id);
  });

  test('never regenerates an id a line already has', () => {
    const result = ensureLineIds([
      { serviceName: 'Consultation', totalPrice: 5000, line_id: 'existing-id-1' },
    ]);
    expect(result[0].line_id).toBe('existing-id-1');
  });

  test('a mix of migrated and legacy lines only gets ids where missing', () => {
    const result = ensureLineIds([
      { serviceName: 'A', line_id: 'keep-me' },
      { serviceName: 'B' },
    ]);
    expect(result[0].line_id).toBe('keep-me');
    expect(result[1].line_id).toBeDefined();
    expect(result[1].line_id).not.toBe('keep-me');
  });

  test('does not mutate the array it was given', () => {
    const original = [{ serviceName: 'A' }];
    const result = ensureLineIds(original);
    expect(original[0].line_id).toBeUndefined(); // the source object is untouched
    expect(result[0].line_id).toBeDefined();
    expect(result).not.toBe(original);
  });

  test('empty array in, empty array out', () => {
    expect(ensureLineIds([])).toEqual([]);
  });
});
