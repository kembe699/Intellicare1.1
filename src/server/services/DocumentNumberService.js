// N1: the single source of GL-/JE-/etc-number allocation. See
// scripts/migrateDocumentNumberCounters.js for why this replaced the old
// "read the highest existing number, sorted as text, +1" pattern used
// independently in AccountingService, patientBills.js, receipts.js (x2),
// patientDeposits.js, cashier.js and cash-transfers.js.
const { sequelize } = require('../models');

const PREFIX = { GL: 'GL', JE: 'JE' };

/**
 * Allocates the next sequential number for a document type, for one clinic,
 * for the calendar month of `date` (or now). MUST be called with the same
 * open transaction the caller will use to create the document itself — the
 * INSERT ... ON CONFLICT DO UPDATE below takes a row lock on the
 * (clinic_id, doc_type, period) counter row as part of resolving the
 * conflict, so a second transaction requesting a number for the same key
 * blocks until this one commits or rolls back. Nothing else needs to retry.
 *
 * Format is unchanged: `GL-YYYYMM-####` / `JE-YYYYMM-####`, zero-padded to 4
 * digits and widening naturally past 9999 (no truncation, no wraparound).
 */
async function getNextDocumentNumber(docType, clinicId, transaction, options = {}) {
  if (!transaction) throw new Error('getNextDocumentNumber requires an open transaction (see its own docstring)');
  if (!clinicId) throw new Error('getNextDocumentNumber requires clinicId');
  const prefix = PREFIX[docType];
  if (!prefix) throw new Error(`Unknown document number type: ${docType}`);

  const date = options.date ? new Date(options.date) : new Date();
  const period = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;

  const [rows] = await sequelize.query(
    `INSERT INTO document_number_counters (clinic_id, doc_type, period, last_number, updated_at)
     VALUES (:clinicId, :docType, :period, 1, NOW())
     ON CONFLICT (clinic_id, doc_type, period)
     DO UPDATE SET last_number = document_number_counters.last_number + 1, updated_at = NOW()
     RETURNING last_number`,
    { replacements: { clinicId, docType, period }, transaction }
  );
  const seq = rows[0].last_number;
  const width = Math.max(4, String(seq).length);
  return `${prefix}-${period}-${String(seq).padStart(width, '0')}`;
}

/**
 * Next GRN number, `GRN-YYYY-####`, tenant-wide (grn_number is unique across the
 * whole tenant, so the counter row uses clinic_id 0). Replaces a COUNT(*)+1
 * that handed two concurrent receipts the same number. The first allocation of
 * a year seeds the counter from the highest number already issued that year.
 * Same locking rule as getNextDocumentNumber: call inside the transaction that
 * inserts the GRN.
 */
async function getNextGrnNumber(transaction, date = new Date()) {
  if (!transaction) throw new Error('getNextGrnNumber requires an open transaction');
  const year = String(new Date(date).getFullYear());
  const [rows] = await sequelize.query(
    `INSERT INTO document_number_counters (clinic_id, doc_type, period, last_number, updated_at)
     VALUES (0, 'GRN', :year,
             (SELECT COALESCE(MAX((regexp_match(grn_number, '^GRN-\\d{4}-(\\d+)$'))[1]::int), 0) + 1
                FROM goods_receipt_notes WHERE grn_number LIKE :like),
             NOW())
     ON CONFLICT (clinic_id, doc_type, period)
     DO UPDATE SET last_number = document_number_counters.last_number + 1, updated_at = NOW()
     RETURNING last_number`,
    { replacements: { year, like: `GRN-${year}-%` }, transaction }
  );
  const seq = rows[0].last_number;
  return `GRN-${year}-${String(seq).padStart(Math.max(4, String(seq).length), '0')}`;
}

module.exports = { getNextDocumentNumber, getNextGrnNumber };
