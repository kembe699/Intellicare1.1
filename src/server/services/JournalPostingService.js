// N3: the one shared helper for the hand-built journal entries that used to
// be near-identically copy-pasted across patientDeposits.js (postDepositGL),
// receipts.js (reversePaymentGL, reverseDepositUsageGL), patientBills.js
// (the payment-posting block), invoices.js (postJournalEntry) and
// cashier.js/cash-transfers.js (their transfer postings) — each with its own
// slightly-drifted copy of currency conversion, number generation, and the
// JournalEntries + JournalEntryLines + AccountLedger writes.
//
// N2: this REQUIRES the caller's own open transaction and never opens one of
// its own — the whole point is that the journal entry and whatever record it
// belongs to (a deposit, a receipt, a bill's payment) commit together or not
// at all, the same way bill creation already shares one transaction with
// AccountingService.createGLFromPatientBill. A posting failure now fails the
// caller's whole operation instead of being swallowed as "non-fatal" — that
// silence is exactly how a cashier could take a payment that was never
// reflected in the ledger.
//
// Deliberately NOT resolving accounts generically — which accounts a given
// posting touches (cash vs bank, 1200 vs 1210 receivable, etc.) is caller
// business logic, not something a generic helper should guess at. Callers
// resolve their own accounts and pass resolved account IDs in `lines`.
//
// Per-line currency rounding here mirrors AccountingService.createGLEntry's
// CURRENT behavior (each line converted independently) — Phase 3 (C6) fixes
// the rounding-absorption gap in both places together, not just one.
const { sequelize, JournalEntries, JournalEntryLines, AccountLedger } = require('../models');
const CurrencyService = require('./CurrencyService');
const AccountingService = require('./AccountingService');
const { getNextDocumentNumber } = require('./DocumentNumberService');

/**
 * @param {object} params
 * @param {number} params.clinicId
 * @param {number|null} params.branchId
 * @param {import('sequelize').Transaction} params.transaction - REQUIRED.
 * @param {string|Date} params.entryDate - posted on this date, not today's (see B6 in Phase 4).
 * @param {string} params.description
 * @param {string} [params.narration]
 * @param {string} [params.reference] - e.g. `RCP-<id>`, `CT-<id>` — used to find this entry again for a reversal.
 * @param {string} [params.currency] - transaction currency; defaults to the clinic's base currency.
 * @param {Array<{accountId: string, debit?: number, credit?: number, description?: string}>} params.lines
 * @param {string} [params.userId]
 * @param {string} [params.sourceModule]
 * @returns {Promise<object>} the created JournalEntries row
 */
async function postJournalEntry({
  clinicId, branchId, transaction, entryDate, description, narration, reference,
  currency, lines, userId, sourceModule = 'billing',
}) {
  if (!transaction) throw new Error('postJournalEntry requires an open transaction');
  if (!clinicId) throw new Error('postJournalEntry requires clinicId');
  if (!description) throw new Error('postJournalEntry requires a description');
  if (!Array.isArray(lines) || lines.length < 2) throw new Error('postJournalEntry requires at least two lines');
  if (lines.some((l) => !l.accountId)) throw new Error('Every posting line needs a resolved accountId');

  const totalDebit = Number(lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0).toFixed(2));
  const totalCredit = Number(lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0).toFixed(2));
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal entry is not balanced: debits ${totalDebit}, credits ${totalCredit}`);
  }

  const baseCurrencyData = await CurrencyService.getBaseCurrency();
  const baseCurrency = baseCurrencyData.code;
  const txnCurrency = currency || baseCurrency;
  const exchangeRate = txnCurrency === baseCurrency
    ? 1.0
    : await AccountingService.getExchangeRate(clinicId, txnCurrency, baseCurrency, entryDate);
  const convert = (amt) => AccountingService.convertAmount(amt, exchangeRate);

  const jeNumber = await getNextDocumentNumber('JE', clinicId, transaction, { date: entryDate });

  const je = await JournalEntries.create({
    clinic_id: clinicId, je_number: jeNumber, entry_date: entryDate, description,
    narration: narration || reference, reference, transaction_currency: txnCurrency, base_currency: baseCurrency,
    exchange_rate: exchangeRate, total_debit: totalDebit, total_credit: totalCredit,
    base_total_debit: convert(totalDebit), base_total_credit: convert(totalCredit),
    status: 'posted', created_by: userId || 'system', posted_by: userId || 'system', posted_date: new Date(),
    branch_id: branchId || null,
  }, { transaction });

  const lineRows = lines.map((line) => ({
    je_id: je.id, account_id: line.accountId,
    debit_amount: line.debit || 0, credit_amount: line.credit || 0,
    base_debit_amount: convert(line.debit || 0), base_credit_amount: convert(line.credit || 0),
    description: line.description || description,
    branch_id: branchId || null,
  }));
  const ledgerRows = lines.map((line) => ({
    clinic_id: clinicId, account_id: line.accountId, transaction_date: entryDate,
    debit_amount: convert(line.debit || 0), credit_amount: convert(line.credit || 0),
    reference_number: jeNumber, description: line.description || description,
    is_posted: true, posted_date: new Date(), source_module: sourceModule,
    branch_id: branchId || null,
  }));

  await JournalEntryLines.bulkCreate(lineRows, { transaction });
  await AccountLedger.bulkCreate(ledgerRows, { transaction });

  return je;
}

module.exports = { postJournalEntry };
