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
              r.name AS room_name,
              s.first_name AS surgeon_first_name, s.last_name AS surgeon_last_name,
              a.first_name AS anesthetist_first_name, a.last_name AS anesthetist_last_name,
              n.first_name AS nurse_first_name, n.last_name AS nurse_last_name
       FROM theatre_operations t
       ${PATIENT_JOIN}
       LEFT JOIN theatre_rooms r ON r.id = t.theatre_room_id
       LEFT JOIN employees s ON s.id = t.surgeon_employee_id
       LEFT JOIN employees a ON a.id = t.anesthetist_employee_id
       LEFT JOIN employees n ON n.id = t.scrub_nurse_employee_id
       WHERE t.id = :id AND t.clinic_id = :clinicId`,
      { replacements: { id, clinicId } }
    );
    if (!op) return null;
    const [checklist] = await sequelize.query(`SELECT * FROM theatre_checklist_items WHERE operation_id = :id ORDER BY phase, sort_order`, { replacements: { id } });
    const [vitals] = await sequelize.query(`SELECT * FROM theatre_vitals WHERE operation_id = :id ORDER BY recorded_at DESC`, { replacements: { id } });
    return { ...op, checklist, vitals };
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
        await sequelize.query(`UPDATE theatre_rooms SET status = 'in_use', updated_at = NOW() WHERE id = :id`, { replacements: { id: op.theatre_room_id }, transaction });
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
        await sequelize.query(`UPDATE theatre_rooms SET status = 'cleaning', updated_at = NOW() WHERE id = :id`, { replacements: { id: op.theatre_room_id }, transaction });
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
        await sequelize.query(`UPDATE theatre_rooms SET status = 'available', updated_at = NOW() WHERE id = :id AND status = 'in_use'`, { replacements: { id: op.theatre_room_id }, transaction });
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
}

module.exports = new TheatreService();
