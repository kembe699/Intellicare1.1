const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { CHECKLIST_TEMPLATE } = require('../scripts/migrateTheatreTables');

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
  async createRequest(data, userId) {
    const {
      clinic_id: clinicId, branch_id: branchId, patient_id: patientId, requesting_department: department,
      procedure_name: procedureName, diagnosis, priority, notes,
    } = data;
    if (!clinicId) throw new Error('clinic_id is required');
    if (!patientId) throw new Error('patient_id is required');
    if (!procedureName || !procedureName.trim()) throw new Error('procedure_name is required');
    const validPriority = ['routine', 'urgent', 'emergency'].includes(priority) ? priority : 'routine';

    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO theatre_requests (id, clinic_id, branch_id, patient_id, requested_by, requesting_department, procedure_name, diagnosis, priority, notes)
       VALUES (:id, :clinicId, :branchId, :patientId, :userId, :department, :procedureName, :diagnosis, :priority, :notes)`,
      { replacements: { id, clinicId, branchId: branchId || null, patientId, userId: userId || null, department: department || null, procedureName: procedureName.trim(), diagnosis: diagnosis || null, priority: validPriority, notes: notes || null } }
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
    if (!existing) throw new Error('Request not found');
    if (existing.status !== 'pending') throw new Error('Only a pending request can be cancelled');
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
    } = data;
    if (!clinicId) throw new Error('clinic_id is required');

    let patientId = patientIdRaw;
    let procedureName = procedureNameRaw;
    if (requestId) {
      const request = await this.getRequest(clinicId, requestId);
      if (!request) throw new Error('Request not found');
      if (request.status !== 'pending') throw new Error('This request has already been scheduled or cancelled');
      patientId = patientId || request.patient_id;
      procedureName = procedureName || request.procedure_name;
    }
    if (!patientId) throw new Error('patient_id is required');
    if (!procedureName || !procedureName.trim()) throw new Error('procedure_name is required');

    const transaction = await sequelize.transaction();
    try {
      const operationId = uuidv4();
      await sequelize.query(
        `INSERT INTO theatre_operations (id, clinic_id, branch_id, request_id, patient_id, theatre_room_id, procedure_name, surgeon_employee_id, anesthetist_employee_id, scrub_nurse_employee_id, scheduled_at, status, created_by)
         VALUES (:id, :clinicId, :branchId, :requestId, :patientId, :roomId, :procedureName, :surgeonId, :anesthetistId, :nurseId, :scheduledAt, 'scheduled', :userId)`,
        { replacements: { id: operationId, clinicId, branchId: branchId || null, requestId: requestId || null, patientId, roomId: roomId || null, procedureName: procedureName.trim(), surgeonId: surgeonId || null, anesthetistId: anesthetistId || null, nurseId: nurseId || null, scheduledAt: scheduledAt || null, userId: userId || null }, transaction }
      );

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
    return { ...op, checklist, vitals, items };
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

  async startOperation(clinicId, id, userId) {
    const [[op]] = await sequelize.query(`SELECT id, status, theatre_room_id FROM theatre_operations WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id, clinicId } });
    if (!op) throw new Error('Operation not found');
    if (op.status !== 'scheduled') throw new Error('Only a scheduled operation can be started');

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
    const [[op]] = await sequelize.query(`SELECT id, status, started_at, theatre_room_id FROM theatre_operations WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id, clinicId } });
    if (!op) throw new Error('Operation not found');
    if (op.status !== 'in_progress') throw new Error('Only an operation in progress can be completed');
    if (!['successful', 'complication', 'death', 'aborted'].includes(outcome)) throw new Error('outcome must be one of: successful, complication, death, aborted');
    if (outcome === 'death' && !causeOfDeath) throw new Error('cause_of_death is required when the outcome is death');

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
      await transaction.commit();
      return this.getOperation(clinicId, id);
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  async cancelOperation(clinicId, id, reason) {
    const [[op]] = await sequelize.query(`SELECT id, status, theatre_room_id FROM theatre_operations WHERE id = :id AND clinic_id = :clinicId`, { replacements: { id, clinicId } });
    if (!op) throw new Error('Operation not found');
    if (op.status === 'completed') throw new Error('A completed operation cannot be cancelled');

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(`UPDATE theatre_operations SET status = 'cancelled', outcome_notes = :reason, updated_at = NOW() WHERE id = :id`, { replacements: { id, reason: reason || null }, transaction });
      if (op.theatre_room_id) {
        // Only clears it if the room is currently marked in_use by this
        // operation — never overwrites a room independently in maintenance/cleaning.
        await sequelize.query(`UPDATE theatre_room_status SET status = 'available', updated_at = NOW() WHERE room_id = :id AND status = 'in_use'`, { replacements: { id: op.theatre_room_id }, transaction });
      }
      await transaction.commit();
      return this.getOperation(clinicId, id);
    } catch (error) {
      if (!transaction.finished) await transaction.rollback().catch(() => {});
      throw error;
    }
  }

  async toggleChecklistItem(operationId, itemId, checked, userId) {
    const [[item]] = await sequelize.query(`SELECT id FROM theatre_checklist_items WHERE id = :itemId AND operation_id = :operationId`, { replacements: { itemId, operationId } });
    if (!item) throw new Error('Checklist item not found');
    await sequelize.query(
      `UPDATE theatre_checklist_items SET is_checked = :checked, checked_by = :userId, checked_at = :checkedAt WHERE id = :itemId`,
      { replacements: { itemId, checked: !!checked, userId: checked ? (userId || null) : null, checkedAt: checked ? new Date() : null } }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM theatre_checklist_items WHERE id = :itemId`, { replacements: { itemId } });
    return updated;
  }

  async addChecklistItem(operationId, phase, itemText) {
    if (!['pre_op', 'intra_op', 'post_op'].includes(phase)) throw new Error('phase must be pre_op, intra_op, or post_op');
    if (!itemText || !itemText.trim()) throw new Error('item text is required');
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
    const { phase, blood_pressure: bp, pulse, temperature, respiratory_rate: respRate, spo2, notes } = data;
    if (!['pre_op', 'intra_op', 'post_op'].includes(phase)) throw new Error('phase must be pre_op, intra_op, or post_op');
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
    if (!locationId) throw new Error('location_id is required');
    if (!itemId) throw new Error('item_id is required');
    if (!(qty > 0)) throw new Error('quantity must be a positive number');

    const [[op]] = await sequelize.query(`SELECT id FROM theatre_operations WHERE id = :operationId AND clinic_id = :clinicId`, { replacements: { operationId, clinicId } });
    if (!op) throw new Error('Operation not found');

    const [[item]] = await sequelize.query(`SELECT id, item_name, unit_of_measure FROM inventory_items WHERE id = :itemId AND clinic_id = :clinicId`, { replacements: { itemId, clinicId } });
    if (!item) throw new Error('Item not found');

    const [[location]] = await sequelize.query(`SELECT id, location_name FROM stock_locations WHERE id = :locationId AND clinic_id = :clinicId`, { replacements: { locationId, clinicId } });
    if (!location) throw new Error('Location not found');

    const transaction = await sequelize.transaction();
    try {
      const [[batch]] = await sequelize.query(
        `SELECT *, (quantity_received - quantity_used) AS available FROM inventory_batches
         WHERE item_id = :itemId AND location_id = :locationId AND status IN ('active', 'partial_use')
           AND (quantity_received - quantity_used) >= :qty
         ORDER BY expiry_date ASC NULLS LAST LIMIT 1`,
        { replacements: { itemId, locationId, qty }, transaction }
      );
      if (!batch) throw new Error(`Not enough "${item.item_name}" available at ${location.location_name} to cover ${qty} ${item.unit_of_measure || 'unit(s)'}`);

      const newUsed = parseFloat(batch.quantity_used) + qty;
      const newStatus = newUsed >= parseFloat(batch.quantity_received) ? 'exhausted' : 'partial_use';
      await sequelize.query(`UPDATE inventory_batches SET quantity_used = :newUsed, status = :status WHERE id = :id`, { replacements: { newUsed, status: newStatus, id: batch.id }, transaction });

      await sequelize.query(
        `INSERT INTO batch_usage_history (id, batch_id, usage_date, quantity_used, usage_type, reference_id, reference_type, used_by, notes)
         VALUES (:id, :batchId, CURRENT_DATE, :qty, 'theatre_use', :operationId, 'theatre_operation', :userId, :notes)`,
        { replacements: { id: uuidv4(), batchId: batch.id, qty, operationId, userId: userId || null, notes: notes || null }, transaction }
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
