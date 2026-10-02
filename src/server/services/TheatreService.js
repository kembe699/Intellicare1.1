const { sequelize, PatientBill } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { CHECKLIST_TEMPLATE } = require('../scripts/migrateTheatreTables');
const AccountingService = require('./AccountingService');
const { addLineItemsToBill } = require('../utils/billingResolver');

// patient_id is polymorphic across `patients` and `lis_participants` — the
// same dual-identity shape inpatient_admissions already uses. A random UUID
// collision between the two tables is not a real-world concern, so no
// separate "source" column is kept; every read LEFT JOINs both and COALESCEs.
const PATIENT_JOIN = `
  LEFT JOIN patients p ON p.id = t.patient_id
  LEFT JOIN lis_participants lp ON lp.id = t.patient_id
`;
const PATIENT_FIELDS = `
  COALESCE(p.first_name, lp.first_name) AS patient_first_name,
  COALESCE(p.last_name, lp.last_name) AS patient_last_name,
  COALESCE(p.patient_id, lp.participant_number) AS patient_code,
  COALESCE(p.gender, lp.gender) AS patient_gender,
  COALESCE(p.date_of_birth, lp.date_of_birth) AS patient_dob
`;

// T10/T11: every route in theatre.js used to collapse every error into a flat
// 400 (writes) or 500 (reads) regardless of what actually went wrong — "not
// found" and "invalid input" and "wrong state to do this" all looked
// identical to a client, which can't tell a typo from a stale page. Errors
// thrown from here carry a real HTTP status; theatre.js reads it back
// (err.statusCode || fallback) instead of guessing one flat code per route.
function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

class TheatreService {
  // ── Patient search (feeds the request/operation patient picker) ─────────
  async searchPatients(q) {
    const like = `%${q}%`;
    const [rows] = await sequelize.query(
      `SELECT id, patient_id AS code, first_name, last_name, gender, date_of_birth, 'patients' AS source
       FROM patients WHERE first_name ILIKE :like OR last_name ILIKE :like OR patient_id ILIKE :like
       UNION ALL
       SELECT id, participant_number AS code, first_name, last_name, gender, date_of_birth, 'lis_participants' AS source
       FROM lis_participants WHERE first_name ILIKE :like OR last_name ILIKE :like OR participant_number ILIKE :like
       ORDER BY last_name, first_name LIMIT 30`,
      { replacements: { like } }
    );
    return rows;
  }

  // ── Requests ──────────────────────────────────────────────────────────
  // Catalog-driven: the frontend only offers services/setup's own
  // category='Procedure' catalog, not free text — service_id is the source
  // of truth for both the procedure's name and its price, so the request
  // and the resulting bill line can never drift from what's actually in the
  // catalog. Bills the patient immediately (fee > 0), the same way a
  // Procedure-category service billed through the normal Billing screens
  // auto-creates a request the OTHER direction (see patientBills.js's
  // createTheatreRequestsFromBill) — this is the forward direction of that
  // same pairing.
  async createRequest(data, userId) {
    const {
      clinic_id: clinicId, branch_id: branchId, patient_id: patientId, requesting_department: department,
      service_id: serviceId, diagnosis, priority, notes,
    } = data;
    if (!clinicId) throw httpError('clinic_id is required', 400);
    if (!patientId) throw httpError('patient_id is required', 400);
    if (!serviceId) throw httpError('service_id is required — pick a Procedure from the catalog', 400);
    const validPriority = ['routine', 'urgent', 'emergency'].includes(priority) ? priority : 'routine';

    const [[service]] = await sequelize.query(
      `SELECT id, service_name, price FROM services WHERE id = :serviceId AND category = 'Procedure' AND is_active = true`,
      { replacements: { serviceId } }
    );
    if (!service) throw httpError('Procedure not found in the service catalog', 404);
    const fee = parseFloat(service.price) || 0;

    const [[patientRow]] = await sequelize.query(
      `SELECT COALESCE(p.first_name, lp.first_name) AS first_name, COALESCE(p.last_name, lp.last_name) AS last_name
       FROM (SELECT :patientId::varchar AS id) x
       LEFT JOIN patients p ON p.id = x.id LEFT JOIN lis_participants lp ON lp.id = x.id`,
      { replacements: { patientId } }
    );
    const patientName = [patientRow?.first_name, patientRow?.last_name].filter(Boolean).join(' ') || 'Theatre Patient';

    // Bill BEFORE inserting the request row, so the row is written once,
    // complete, with bill_id already set — no second UPDATE needed. A fee of
    // 0 (a catalog procedure priced at 0) means "not billed through this
    // module", same convention theatre_operations.procedure_fee already
    // uses at scheduling time.
    let billId = null;
    if (fee > 0) {
      const bill = await addLineItemsToBill({
        patientId, patientName, clinicId, branchId,
        lineItems: [{ serviceId: service.id, serviceName: service.service_name, quantity: 1, unitPrice: fee, totalPrice: fee, revenueCategory: 'procedure', department: 'Theatre' }],
        notes: `Theatre request — ${service.service_name}`,
        createdBy: userId ? String(userId) : 'System',
      });
      billId = bill.id;
    }

    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO theatre_requests (id, clinic_id, branch_id, patient_id, requested_by, requesting_department,
         procedure_name, service_id, estimated_fee, fee_currency, bill_id, billed_at, diagnosis, priority, notes)
       VALUES (:id, :clinicId, :branchId, :patientId, :userId, :department,
         :procedureName, :serviceId, :estimatedFee, 'SSP', :billId, :billedAt, :diagnosis, :priority, :notes)`,
      { replacements: {
          id, clinicId, branchId: branchId || null, patientId, userId: userId || null, department: department || null,
          procedureName: service.service_name, serviceId, estimatedFee: fee, billId, billedAt: billId ? new Date() : null,
          diagnosis: diagnosis || null, priority: validPriority, notes: notes || null,
        } }
    );
    return this.getRequest(clinicId, id);
  }

  async getRequest(clinicId, id) {
    const [[row]] = await sequelize.query(
      `SELECT t.*, ${PATIENT_FIELDS} FROM theatre_requests t ${PATIENT_JOIN} WHERE t.id = :id AND t.clinic_id = :clinicId`,
      { replacements: { id, clinicId } }
    );
    return row || null;
  }

  async cancelRequest(clinicId, id, reason) {
    const [[existing]] = await sequelize.query(`SELECT id, status FROM theatre_requests WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id, clinicId } });
    if (!existing) throw httpError('Request not found', 404);
    if (existing.status !== 'pending') throw httpError('Only a pending request can be cancelled', 409);
    await sequelize.query(
      `UPDATE theatre_requests SET status = 'cancelled', cancelled_reason = :reason, updated_at = NOW() WHERE id = :id`,
      { replacements: { id, reason: reason || null } }
    );
    return this.getRequest(clinicId, id);
  }

  // ── Operations ────────────────────────────────────────────────────────
  // Schedules an operation, either from an existing request (marks it
  // scheduled) or directly. Seeds the WHO-style checklist across all three
  // phases so staff have something to work from immediately.
  async scheduleOperation(data, userId) {
    const {
      clinic_id: clinicId, branch_id: branchId, request_id: requestId, patient_id: patientIdRaw,
      theatre_room_id: roomId, procedure_name: procedureNameRaw, surgeon_employee_id: surgeonId,
      anesthetist_employee_id: anesthetistId, scrub_nurse_employee_id: nurseId, scheduled_at: scheduledAt,
      // Multi-member team — a role's single `*_employee_id` above still wins
      // as "the primary" (first in the array, or the lone single id) so every
      // existing single-column reader keeps working; the full list lands in
      // theatre_operation_team below.
      surgeon_employee_ids: surgeonIds, anesthetist_employee_ids: anesthetistIds, scrub_nurse_employee_ids: nurseIds,
      // T1: the fee is captured up front, when the procedure is actually
      // being booked (the point at which someone knows what it should cost) —
      // not guessed at afterward when the operation completes. A fee of 0/
      // unset means "not billed through this module" (e.g. a covered/charity
      // case), which completeOperation below respects rather than billing 0.
      procedure_fee: procedureFeeRaw, fee_currency: feeCurrencyRaw,
    } = data;
    let procedureFee = procedureFeeRaw != null ? parseFloat(procedureFeeRaw) : null;
    if (procedureFee != null && (isNaN(procedureFee) || procedureFee < 0)) throw httpError('procedure_fee must be a non-negative number', 400);
    let feeCurrency = (feeCurrencyRaw || 'SSP').toUpperCase();
    if (!clinicId) throw httpError('clinic_id is required', 400);

    let patientId = patientIdRaw;
    let procedureName = procedureNameRaw;
    // Set only when the request was already billed (TheatreService.createRequest,
    // or the reverse auto-request hook in patientBills.js) — carried onto the
    // new operation's own bill_id so completeOperation's `!bill_id` guard
    // skips billing it again. Any client-supplied procedure_fee is ignored
    // once a request has already settled this.
    let billIdFromRequest = null;
    if (requestId) {
      const request = await this.getRequest(clinicId, requestId);
      if (!request) throw httpError('Request not found', 404);
      if (request.status !== 'pending') throw httpError('This request has already been scheduled or cancelled', 409);
      patientId = patientId || request.patient_id;
      procedureName = procedureName || request.procedure_name;
      if (request.bill_id) {
        billIdFromRequest = request.bill_id;
        procedureFee = parseFloat(request.estimated_fee) || 0;
        feeCurrency = (request.fee_currency || 'SSP').toUpperCase();
      }
    }
    if (!patientId) throw httpError('patient_id is required', 400);
    if (!procedureName || !procedureName.trim()) throw httpError('procedure_name is required', 400);

    const transaction = await sequelize.transaction();
    try {
      // T9: double-booking prevention. theatre_operations has no expected-
      // duration field (scheduling only captures a start time), so a real
      // interval-overlap check isn't possible from the data alone — instead,
      // any two still-live operations (scheduled or in_progress) sharing a
      // room within one DEFAULT_BLOCK_HOURS window of each other are treated
      // as conflicting, which is the same assumption a paper OR whiteboard
      // makes when a case is booked "in Theatre 2 at 9am": the room is
      // committed for a block, not an instant. pg_advisory_xact_lock
      // serializes two concurrent schedule requests for the SAME room so
      // this check-then-insert can't race — the lock is released
      // automatically when the transaction commits or rolls back.
      if (roomId) {
        await sequelize.query(`SELECT pg_advisory_xact_lock(hashtext(:roomId))`, { replacements: { roomId }, transaction });
        if (scheduledAt) {
          const DEFAULT_BLOCK_HOURS = 4;
          const [[conflict]] = await sequelize.query(
            `SELECT id, procedure_name, scheduled_at FROM theatre_operations
             WHERE theatre_room_id = :roomId AND clinic_id = :clinicId
               AND status IN ('scheduled', 'in_progress')
               AND scheduled_at IS NOT NULL
               AND scheduled_at < (:scheduledAt::timestamptz + (:blockHours || ' hours')::interval)
               AND (scheduled_at + (:blockHours || ' hours')::interval) > :scheduledAt::timestamptz
             LIMIT 1`,
            { replacements: { roomId, clinicId, scheduledAt, blockHours: DEFAULT_BLOCK_HOURS }, transaction }
          );
          if (conflict) {
            throw httpError(`This room is already booked for "${conflict.procedure_name}" around ${new Date(conflict.scheduled_at).toLocaleString()} — choose a different time or room.`, 409);
          }
        }
      }

      // Derive each role's primary (first id wins) BEFORE the INSERT, so the
      // single surgeon_employee_id/etc. columns — still what every existing
      // reader joins on — are always "the first team member of that role",
      // whether the caller sent a plural array, a lone singular id, or both.
      const TEAM_ROLES = [
        ['surgeon', surgeonIds, surgeonId],
        ['anesthetist', anesthetistIds, anesthetistId],
        ['scrub_nurse', nurseIds, nurseId],
      ];
      const roleMembers = {};
      const primary = {};
      for (const [role, idsArray, singleId] of TEAM_ROLES) {
        const ids = [...new Set((Array.isArray(idsArray) && idsArray.length ? idsArray : (singleId ? [singleId] : [])).filter(Boolean))];
        roleMembers[role] = ids;
        primary[role] = ids[0] || null;
      }

      const operationId = uuidv4();
      await sequelize.query(
        `INSERT INTO theatre_operations (id, clinic_id, branch_id, request_id, patient_id, theatre_room_id, procedure_name, surgeon_employee_id, anesthetist_employee_id, scrub_nurse_employee_id, scheduled_at, status, created_by, procedure_fee, fee_currency, bill_id, billed_at)
         VALUES (:id, :clinicId, :branchId, :requestId, :patientId, :roomId, :procedureName, :surgeonId, :anesthetistId, :nurseId, :scheduledAt, 'scheduled', :userId, :procedureFee, :feeCurrency, :billId, :billedAt)`,
        { replacements: { id: operationId, clinicId, branchId: branchId || null, requestId: requestId || null, patientId, roomId: roomId || null, procedureName: procedureName.trim(), surgeonId: primary.surgeon, anesthetistId: primary.anesthetist, nurseId: primary.scrub_nurse, scheduledAt: scheduledAt || null, userId: userId || null, procedureFee, feeCurrency, billId: billIdFromRequest, billedAt: billIdFromRequest ? new Date() : null }, transaction }
      );

      for (const [role, ids] of Object.entries(roleMembers)) {
        for (const employeeId of ids) {
          await sequelize.query(
            `INSERT INTO theatre_operation_team (id, operation_id, employee_id, role) VALUES (:id, :operationId, :employeeId, :role) ON CONFLICT DO NOTHING`,
            { replacements: { id: uuidv4(), operationId, employeeId, role }, transaction }
          );
        }
      }

      let sortOrder = 0;
      for (const phase of ['pre_op', 'intra_op', 'post_op']) {
        for (const itemText of CHECKLIST_TEMPLATE[phase]) {
          await sequelize.query(
            `INSERT INTO theatre_checklist_items (id, operation_id, phase, item_text, sort_order) VALUES (:id, :operationId, :phase, :itemText, :sortOrder)`,
            { replacements: { id: uuidv4(), operationId, phase, itemText, sortOrder: sortOrder++ }, transaction }
          );
        }
      }

      if (requestId) {
        await sequelize.query(`UPDATE theatre_requests SET status = 'scheduled', updated_at = NOW() WHERE id = :id`, { replacements: { id: requestId }, transaction });
      }

      await transaction.commit();
      return this.getOperation(clinicId, operationId);
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  async getOperation(clinicId, id) {
    const [[op]] = await sequelize.query(
      `SELECT t.*, ${PATIENT_FIELDS},
              r.room_number AS room_name,
              s.first_name AS surgeon_first_name, s.last_name AS surgeon_last_name,
              a.first_name AS anesthetist_first_name, a.last_name AS anesthetist_last_name,
              n.first_name AS nurse_first_name, n.last_name AS nurse_last_name
       FROM theatre_operations t
       ${PATIENT_JOIN}
       LEFT JOIN rooms r ON r.id = t.theatre_room_id
       LEFT JOIN employees s ON s.id = t.surgeon_employee_id
       LEFT JOIN employees a ON a.id = t.anesthetist_employee_id
       LEFT JOIN employees n ON n.id = t.scrub_nurse_employee_id
       WHERE t.id = :id AND t.clinic_id = :clinicId`,
      { replacements: { id, clinicId } }
    );
    if (!op) return null;
    const [checklist] = await sequelize.query(`SELECT * FROM theatre_checklist_items WHERE operation_id = :id ORDER BY phase, sort_order`, { replacements: { id } });
    const [vitals] = await sequelize.query(`SELECT * FROM theatre_vitals WHERE operation_id = :id ORDER BY recorded_at DESC`, { replacements: { id } });
    const [items] = await sequelize.query(`SELECT * FROM theatre_operation_items WHERE operation_id = :id ORDER BY dispensed_at DESC`, { replacements: { id } });
    const team = await this.getOperationTeam(id);
    return { ...op, checklist, vitals, items, team };
  }

  // ── Surgical team (full multi-member list) ──────────────────────────────
  // surgeon_employee_id/anesthetist_employee_id/scrub_nurse_employee_id on
  // theatre_operations itself stay single-valued (the primary, set once at
  // scheduling time) — this table is the full roster, read separately so
  // every pre-existing reader of those single columns is unaffected.
  async getOperationTeam(operationId) {
    const [rows] = await sequelize.query(
      `SELECT t.*, e.first_name, e.last_name FROM theatre_operation_team t
       JOIN employees e ON e.id = t.employee_id WHERE t.operation_id = :operationId ORDER BY t.role, t.created_at`,
      { replacements: { operationId } }
    );
    return rows;
  }

  async addTeamMember(clinicId, operationId, { employee_id: employeeId, role }) {
    await this._assertOperationEditable(operationId, clinicId);
    if (!employeeId) throw httpError('employee_id is required', 400);
    if (!['surgeon', 'anesthetist', 'scrub_nurse'].includes(role)) throw httpError('role must be surgeon, anesthetist, or scrub_nurse', 400);
    await sequelize.query(
      `INSERT INTO theatre_operation_team (id, operation_id, employee_id, role) VALUES (:id, :operationId, :employeeId, :role) ON CONFLICT DO NOTHING`,
      { replacements: { id: uuidv4(), operationId, employeeId, role } }
    );
    return this.getOperationTeam(operationId);
  }

  // Deliberately never re-derives theatre_operations.surgeon_employee_id/etc.
  // from what remains — those columns are populate-once at scheduling time,
  // per the same "existing single-column readers stay unaffected" rule
  // scheduleOperation follows. Removing the primary leaves that column
  // pointing at someone no longer on the team list; the full roster in this
  // table remains the source of truth for anyone who reads it instead.
  async removeTeamMember(clinicId, operationId, teamMemberId) {
    await this._assertOperationEditable(operationId, clinicId);
    await sequelize.query(`DELETE FROM theatre_operation_team WHERE id = :teamMemberId AND operation_id = :operationId`, { replacements: { teamMemberId, operationId } });
    return this.getOperationTeam(operationId);
  }

  // room_id points at the general `rooms` table (room_type = 'or'), managed
  // from /setup/rooms — this side table only tracks the OR-specific live
  // status a ward room has no use for.
  async _setRoomStatus(roomId, status, transaction) {
    await sequelize.query(
      `INSERT INTO theatre_room_status (room_id, status, updated_at) VALUES (:roomId, :status, NOW())
       ON CONFLICT (room_id) DO UPDATE SET status = :status, updated_at = NOW()`,
      { replacements: { roomId, status }, transaction }
    );
  }

  // T4: the only way a room left 'cleaning' (set by completeOperation) was a
  // manual database fix — nothing in the app ever moved it back to
  // 'available', so a room stayed blocked in the OR board indefinitely after
  // its first use. Only valid from 'cleaning' (or already 'available',
  // treated as a harmless no-op) — a room in active use or under maintenance
  // isn't "readied" by this action.
  async setRoomReady(roomId) {
    const [[current]] = await sequelize.query(`SELECT status FROM theatre_room_status WHERE room_id = :roomId`, { replacements: { roomId } });
    if (current && !['cleaning', 'available'].includes(current.status)) {
      throw httpError(`Room is currently ${current.status} — cannot mark it ready from that state`, 409);
    }
    await this._setRoomStatus(roomId, 'available');
  }

  async startOperation(clinicId, id, userId) {
    const [[op]] = await sequelize.query(`SELECT id, status, theatre_room_id FROM theatre_operations WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id, clinicId } });
    if (!op) throw httpError('Operation not found', 404);
    if (op.status !== 'scheduled') throw httpError('Only a scheduled operation can be started', 409);

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `UPDATE theatre_operations SET status = 'in_progress', started_at = NOW(), updated_at = NOW() WHERE id = :id`,
        { replacements: { id }, transaction }
      );
      if (op.theatre_room_id) {
        await this._setRoomStatus(op.theatre_room_id, 'in_use', transaction);
      }
      await transaction.commit();
      return this.getOperation(clinicId, id);
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  async completeOperation(clinicId, id, { outcome, outcome_notes: outcomeNotes, cause_of_death: causeOfDeath }, userId) {
    const [[op]] = await sequelize.query(
      `SELECT t.id, t.status, t.started_at, t.theatre_room_id, t.branch_id, t.patient_id, t.procedure_name, t.procedure_fee, t.fee_currency, t.bill_id,
              COALESCE(p.first_name, lp.first_name) AS patient_first_name, COALESCE(p.last_name, lp.last_name) AS patient_last_name
       FROM theatre_operations t ${PATIENT_JOIN} WHERE t.id = :id AND t.clinic_id = :clinicId`,
      { replacements: { id, clinicId } }
    );
    if (!op) throw httpError('Operation not found', 404);
    if (op.status !== 'in_progress') throw httpError('Only an operation in progress can be completed', 409);
    if (!['successful', 'complication', 'death', 'aborted'].includes(outcome)) throw httpError('outcome must be one of: successful, complication, death, aborted', 400);
    if (outcome === 'death' && !causeOfDeath) throw httpError('cause_of_death is required when the outcome is death', 400);

    const endedAt = new Date();
    const durationMinutes = op.started_at ? Math.round((endedAt.getTime() - new Date(op.started_at).getTime()) / 60000) : null;

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `UPDATE theatre_operations SET status = 'completed', ended_at = :endedAt, duration_minutes = :duration,
           outcome = :outcome, outcome_notes = :outcomeNotes, cause_of_death = :causeOfDeath, updated_at = NOW()
         WHERE id = :id`,
        { replacements: { id, endedAt, duration: durationMinutes, outcome, outcomeNotes: outcomeNotes || null, causeOfDeath: causeOfDeath || null }, transaction }
      );
      if (op.theatre_room_id) {
        await this._setRoomStatus(op.theatre_room_id, 'cleaning', transaction);
      }

      // T1: bill the procedure fee once the operation actually happened — a
      // fee was captured at scheduling time (theatre_operations.procedure_fee,
      // set by whoever booked the case); nothing bills automatically if it
      // was left unset (a covered/charity case, or a fee genuinely not known
      // yet — someone can still add it to the bill manually from Billing).
      // Guarded by bill_id so a retried/duplicate completeOperation call
      // (which fails anyway on the status check above once this succeeds)
      // can never double-bill. Kept deliberately simple — a single "Theatre
      // procedure" line at base currency SSP, not scheme-priced — matching
      // how a genuinely new bill is created elsewhere in this app
      // (PatientBill.create + AccountingService.createGLFromPatientBill in
      // one shared transaction), since no shared cross-module "bill this
      // patient for X" helper exists yet to call into instead.
      let billId = op.bill_id;
      if (!billId && op.procedure_fee != null && parseFloat(op.procedure_fee) > 0) {
        const fee = parseFloat(op.procedure_fee);
        const patientName = [op.patient_first_name, op.patient_last_name].filter(Boolean).join(' ') || 'Theatre Patient';
        const bill = await PatientBill.create({
          clinic_id: clinicId, branch_id: op.branch_id || null, patient_id: op.patient_id, patient_name: patientName,
          bill_number: `THR-${Date.now().toString().slice(-8)}`, total_amount: fee, paid_amount: 0, balance_amount: fee,
          status: 'pending', bill_date: endedAt.toISOString().split('T')[0], created_by: userId || 'system',
          bill_currency: (op.fee_currency || 'SSP').toUpperCase(),
          services: [{ line_id: uuidv4(), serviceName: `Theatre: ${op.procedure_name}`, quantity: 1, unitPrice: fee, totalPrice: fee, department: 'Theatre' }],
        }, { transaction });
        await AccountingService.createGLFromPatientBill(bill.toJSON(), userId || 'system', transaction);
        billId = bill.id;
        await sequelize.query(`UPDATE theatre_operations SET bill_id = :billId, billed_at = NOW() WHERE id = :id`, { replacements: { billId, id }, transaction });
      }

      await transaction.commit();
      return this.getOperation(clinicId, id);
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  async cancelOperation(clinicId, id, reason) {
    const [[op]] = await sequelize.query(`SELECT id, status, theatre_room_id, request_id FROM theatre_operations WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id, clinicId } });
    if (!op) throw httpError('Operation not found', 404);
    if (op.status === 'completed') throw httpError('A completed operation cannot be cancelled', 409);

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(`UPDATE theatre_operations SET status = 'cancelled', outcome_notes = :reason, updated_at = NOW() WHERE id = :id`, { replacements: { id, reason: reason || null }, transaction });
      if (op.theatre_room_id) {
        // Only clears it if the room is currently marked in_use by this
        // operation — never overwrites a room independently in maintenance/cleaning.
        await sequelize.query(`UPDATE theatre_room_status SET status = 'available', updated_at = NOW() WHERE room_id = :id AND status = 'in_use'`, { replacements: { id: op.theatre_room_id }, transaction });
      }
      // T7: an operation scheduled FROM a request marks that request
      // 'scheduled' (see scheduleOperation) — without reverting it here,
      // cancelling the operation left the request permanently stuck at
      // 'scheduled' with no operation actually happening, so it could never
      // be seen as pending or rescheduled again. Only reverts a request this
      // SAME cancel actually orphaned (still 'scheduled', not already
      // cancelled/re-scheduled independently by someone else).
      if (op.request_id) {
        await sequelize.query(
          `UPDATE theatre_requests SET status = 'pending', updated_at = NOW() WHERE id = :id AND status = 'scheduled'`,
          { replacements: { id: op.request_id }, transaction }
        );
      }
      await transaction.commit();
      return this.getOperation(clinicId, id);
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  // T8: a completed or cancelled operation is a closed clinical record —
  // without this, a checklist item, a vitals reading, or a stock deduction
  // could still be added against a case that's long since finished (or never
  // happened at all), quietly rewriting history after the fact with nothing
  // to show it happened out of sequence. Called by every write below that
  // targets an existing operation.
  async _assertOperationEditable(operationId, clinicId) {
    const where = clinicId != null ? 'id = :operationId AND clinic_id = :clinicId' : 'id = :operationId';
    const [[op]] = await sequelize.query(`SELECT id, status FROM theatre_operations WHERE ${where}`, { replacements: { operationId, clinicId } });
    if (!op) throw httpError('Operation not found', 404);
    if (['completed', 'cancelled'].includes(op.status)) {
      throw httpError(`This operation is ${op.status} and can no longer be updated`, 409);
    }
    return op;
  }

  async toggleChecklistItem(operationId, itemId, checked, userId) {
    await this._assertOperationEditable(operationId);
    const [[item]] = await sequelize.query(`SELECT id FROM theatre_checklist_items WHERE id = :itemId AND operation_id = :operationId`, { replacements: { itemId, operationId } });
    if (!item) throw httpError('Checklist item not found', 404);
    await sequelize.query(
      `UPDATE theatre_checklist_items SET is_checked = :checked, checked_by = :userId, checked_at = :checkedAt WHERE id = :itemId`,
      { replacements: { itemId, checked: !!checked, userId: checked ? (userId || null) : null, checkedAt: checked ? new Date() : null } }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM theatre_checklist_items WHERE id = :itemId`, { replacements: { itemId } });
    return updated;
  }

  async addChecklistItem(operationId, phase, itemText) {
    await this._assertOperationEditable(operationId);
    if (!['pre_op', 'intra_op', 'post_op'].includes(phase)) throw httpError('phase must be pre_op, intra_op, or post_op', 400);
    if (!itemText || !itemText.trim()) throw httpError('item text is required', 400);
    const [[{ maxOrder }]] = await sequelize.query(`SELECT COALESCE(MAX(sort_order), -1) AS "maxOrder" FROM theatre_checklist_items WHERE operation_id = :operationId AND phase = :phase`, { replacements: { operationId, phase } });
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO theatre_checklist_items (id, operation_id, phase, item_text, sort_order) VALUES (:id, :operationId, :phase, :itemText, :sortOrder)`,
      { replacements: { id, operationId, phase, itemText: itemText.trim(), sortOrder: maxOrder + 1 } }
    );
    const [[created]] = await sequelize.query(`SELECT * FROM theatre_checklist_items WHERE id = :id`, { replacements: { id } });
    return created;
  }

  async recordVitals(operationId, data, userId) {
    await this._assertOperationEditable(operationId);
    const { phase, blood_pressure: bp, pulse, temperature, respiratory_rate: respRate, spo2, notes } = data;
    if (!['pre_op', 'intra_op', 'post_op'].includes(phase)) throw httpError('phase must be pre_op, intra_op, or post_op', 400);
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO theatre_vitals (id, operation_id, phase, recorded_by, blood_pressure, pulse, temperature, respiratory_rate, spo2, notes)
       VALUES (:id, :operationId, :phase, :userId, :bp, :pulse, :temperature, :respRate, :spo2, :notes)`,
      { replacements: { id, operationId, phase, userId: userId || null, bp: bp || null, pulse: pulse || null, temperature: temperature || null, respRate: respRate || null, spo2: spo2 || null, notes: notes || null } }
    );
    const [[created]] = await sequelize.query(`SELECT * FROM theatre_vitals WHERE id = :id`, { replacements: { id } });
    return created;
  }

  // ── Items used (drugs, consumables, blood) ───────────────────────────────
  // Deducts real stock through the same tables POST /api/inventory/batches/:id/use
  // writes (inventory_batches.quantity_used, inventory_items.quantity_on_hand,
  // stock_by_location, batch_usage_history) — not a parallel ledger — so this
  // usage shows up in the item's own transaction history too. Picks the
  // batch with the nearest expiry at that location (FEFO) automatically;
  // the requested quantity must fit in a single batch — a theatre nurse
  // isn't expected to reconcile a split across two half-empty boxes.
  async recordItemUsage(clinicId, operationId, { location_id: locationId, item_id: itemId, quantity, notes }, userId) {
    const qty = parseFloat(quantity);
    if (!locationId) throw httpError('location_id is required', 400);
    if (!itemId) throw httpError('item_id is required', 400);
    if (!(qty > 0)) throw httpError('quantity must be a positive number', 400);

    await this._assertOperationEditable(operationId, clinicId);

    const [[item]] = await sequelize.query(`SELECT id, item_name, unit_of_measure FROM inventory_items WHERE id = :itemId AND clinic_id = :clinicId`, { replacements: { itemId, clinicId } });
    if (!item) throw httpError('Item not found', 404);

    const [[location]] = await sequelize.query(`SELECT id, location_name FROM stock_locations WHERE id = :locationId AND clinic_id = :clinicId`, { replacements: { locationId, clinicId } });
    if (!location) throw httpError('Location not found', 404);

    const transaction = await sequelize.transaction();
    try {
      // T3: FOR UPDATE — without this, two concurrent usage calls against the
      // same batch (two theatre nurses charting items on different operations
      // at once, or a theatre usage racing a pharmacy dispense of the same
      // batch) both read the same "available" quantity and both proceed,
      // oversubscribing stock that was never really there. The second
      // request now blocks until the first commits and re-reads the
      // just-updated quantity_used.
      const [[batch]] = await sequelize.query(
        `SELECT *, (quantity_received - quantity_used) AS available FROM inventory_batches
         WHERE item_id = :itemId AND location_id = :locationId AND status IN ('active', 'partial_use')
           AND (quantity_received - quantity_used) >= :qty
         ORDER BY expiry_date ASC NULLS LAST LIMIT 1
         FOR UPDATE`,
        { replacements: { itemId, locationId, qty }, transaction }
      );
      if (!batch) throw httpError(`Not enough "${item.item_name}" available at ${location.location_name} to cover ${qty} ${item.unit_of_measure || 'unit(s)'}`, 409);

      const newUsed = parseFloat(batch.quantity_used) + qty;
      const newStatus = newUsed >= parseFloat(batch.quantity_received) ? 'exhausted' : 'partial_use';
      await sequelize.query(`UPDATE inventory_batches SET quantity_used = :newUsed, status = :status WHERE id = :id`, { replacements: { newUsed, status: newStatus, id: batch.id }, transaction });

      await sequelize.query(
        `INSERT INTO batch_usage_history (id, batch_id, usage_date, quantity_used, usage_type, reference_id, reference_type, used_by, notes)
         VALUES (:id, :batchId, CURRENT_DATE, :qty, 'theatre_use', :operationId, 'theatre_operation', :userId, :notes)`,
        { replacements: { id: uuidv4(), batchId: batch.id, qty, operationId, userId: userId || null, notes: notes || null }, transaction }
      );

      // T2: a real audit trail — without this, stock silently disappeared
      // from quantity_on_hand/stock_by_location with nothing in
      // inventory_transactions (the table every stock report/reconciliation
      // actually reads) to show where it went. Mirrors the exact shape
      // pharmacyModule.js's dispense-stock-reduction step already writes.
      await sequelize.query(
        `INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
           quantity_change, from_location_id, batch_id, unit_cost, total_cost,
           reference_type, reference_id, transaction_date, notes, created_by)
         VALUES (:id, :clinicId, :txnNumber, :itemId, 'usage',
           :qtyChange, :locationId, :batchId, :unitCost, :totalCost,
           'theatre_operation', :operationId, CURRENT_DATE, :notes, :userId)`,
        {
          replacements: {
            id: uuidv4(), clinicId, txnNumber: `TXN-THR-${Date.now().toString().slice(-8)}`, itemId,
            qtyChange: -qty, locationId, batchId: batch.id,
            unitCost: parseFloat(batch.unit_cost) || 0, totalCost: (parseFloat(batch.unit_cost) || 0) * qty,
            operationId, notes: notes || `Used in operation ${operationId}`, userId: userId || null,
          },
          transaction,
        }
      );

      await sequelize.query(`UPDATE inventory_items SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE id = :itemId`, { replacements: { qty, itemId }, transaction });
      await sequelize.query(`UPDATE stock_by_location SET quantity_on_hand = GREATEST(0, quantity_on_hand - :qty) WHERE item_id = :itemId AND location_id = :locationId`, { replacements: { qty, itemId, locationId }, transaction });

      const usageId = uuidv4();
      await sequelize.query(
        `INSERT INTO theatre_operation_items (id, operation_id, item_id, item_name, batch_id, location_id, location_name, quantity, unit_of_measure, dispensed_by, notes)
         VALUES (:id, :operationId, :itemId, :itemName, :batchId, :locationId, :locationName, :qty, :uom, :userId, :notes)`,
        { replacements: { id: usageId, operationId, itemId, itemName: item.item_name, batchId: batch.id, locationId, locationName: location.location_name, qty, uom: item.unit_of_measure || null, userId: userId || null, notes: notes || null }, transaction }
      );

      await transaction.commit();
      const [[created]] = await sequelize.query(`SELECT * FROM theatre_operation_items WHERE id = :id`, { replacements: { id: usageId } });
      return created;
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }
}

module.exports = new TheatreService();
