const express = require('express');
const { isUniqueViolation, isDuplicateColumn } = require('../utils/dbErrors');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');

// Named-parameter counterpart to branchFilter's getBranchConditionSQL, for the handlers
// below that already build their query with Sequelize's :param replacements object
// instead of positional `?` — the two placeholder styles can't be mixed within one
// sequelize.query() call, so a query using :named replacements needs this instead of
// splicing in the `?`-based helper. Same rules as getBranchConditionSQL: admins are
// never filtered, and the branch comes from req.branchContext first, req.user as fallback.
function getBranchConditionNamed(req, alias, paramName = 'branchId') {
  if (!req.user || req.user.role === 'admin') return { sql: '', replacements: {} };
  const branchId = req.branchContext?.branchId || req.user.branchId || null;
  if (!branchId) return { sql: '', replacements: {} };
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return { sql: ` AND ${col} = :${paramName}`, replacements: { [paramName]: branchId } };
}

// Only for the module-scope boot IIFEs below and findByPhone's default arg, which run
// outside any request/tenant context (see tenantContext.js) and so always resolve to the
// default tenant, same as every other file-scope migration in this codebase. Every actual
// route handler shadows this with its own request-scoped `const { sequelize: db } =
// req.models` — this module-level one was simply never defined at all, silently turning
// every db.query call below into a caught (and, worse, misleadingly logged) ReferenceError.
const { sequelize: db } = require('../models');

// Matches this app's existing sidebar role groupings for the corresponding screens, so
// API-level enforcement lines up with what's actually shown/hidden in the UI instead of
// drifting into its own separate policy.
// Results/history reads are needed by doctors too (reviewing their own patients' results),
// not just lab staff.

// Who may look a person up in order to serve them.
//
// Registering a participant is reception's job, but *finding* one is not: the
// same patient picker is used to dispense a drug, raise a bill and write a
// prescription, so pharmacy and cashier need to read this list even though they
// never write to it. Leaving pharmacy out made the picker come back empty on
// any tenant whose people are registered through the LIS rather than the main
// patient registry — the frontend requests patients and participants together
// and just skips whichever half fails, so a 403 here looked like "no patients"
// rather than a permission error.

// Who may register a walk-in.
//
// Registering is reception's job in the normal flow, but the dispensing counter
// and the billing desk both offer a "walk-in patient" shortcut for someone who
// arrives without having been registered first. Those screens are open to
// pharmacy and doctor respectively, so restricting this to reception meant the
// button was visible, enabled, and returned 403 — the same shape of mismatch as
// the participant list, and just as invisible from either file alone.

// mysql2 auto-parses a true JSON-typed column into an object, but MariaDB (common on
// shared hosts like Hostinger) stores its JSON columns as LONGTEXT under the hood, so the
// driver can't tell it's JSON and hands back the raw string instead — silently breaking
// every `.vitals.blood_pressure`-style read on that host while working fine locally on
// real MySQL. Parse explicitly so this works the same on both.
function parseJSONField(v, fallback = {}) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// ==========================================
// 1. Participant Registration
// ==========================================
(async () => {
  try {
    await db.query(`ALTER TABLE lis_test_orders ADD COLUMN room_number VARCHAR(50) DEFAULT NULL`);
    console.log('✅ Added room_number to lis_test_orders');
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    await db.query(`ALTER TABLE lis_test_orders ADD COLUMN clinic_id VARCHAR(36) DEFAULT NULL`);
    console.log('✅ Added clinic_id to lis_test_orders');
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    await db.query(`ALTER TABLE lis_test_orders ADD COLUMN clinic_name VARCHAR(255) DEFAULT NULL`);
    console.log('✅ Added clinic_name to lis_test_orders');
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    await db.query(`ALTER TABLE lis_results ADD COLUMN recorded_by VARCHAR(36) DEFAULT NULL`);
    console.log('✅ Added recorded_by to lis_results');
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    await db.query(`ALTER TABLE lis_test_orders ADD COLUMN triaged_by INT DEFAULT NULL`);
    console.log('✅ Added triaged_by to lis_test_orders');
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    await db.query(`ALTER TABLE lis_test_orders ADD COLUMN triaged_at TIMESTAMP NULL DEFAULT NULL`);
    console.log('✅ Added triaged_at to lis_test_orders');
  } catch (e) {
    // Ignore error if column already exists
  }
})();

// Guards the duplicate-phone check in POST /participants below against the same
// check-then-insert race already found and fixed in billing/inpatient: a plain SELECT
// before the INSERT lets two concurrent registrations for the same phone both pass the
// check before either commits. A plain (non-unique) index is added unconditionally so
// the transactional row/gap-lock in POST /participants has something to lock against even
// if the unique index below can't be applied; the unique index is the real, DB-enforced
// guarantee and is attempted separately since — unlike visit_id/bed_id — this table
// already has at least one pre-existing pair of different people sharing one phone
// (a plausible real scenario, e.g. a shared household/guardian phone), which would block
// the unique index from being created until that's manually reviewed and resolved.
(async () => {
  try {
    const [[idxCheck]] = await db.query(`
      SELECT COUNT(*) AS cnt FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'lis_participants' AND indexname = 'idx_lis_participants_phone'
    `);
    if (idxCheck.cnt === 0) {
      await db.query(`CREATE INDEX idx_lis_participants_phone ON lis_participants(phone)`);
      console.log('✅ Added index on lis_participants.phone');
    }
  } catch (e) {
    console.log('Note: Could not ensure index on lis_participants.phone:', e.message);
  }
  try {
    const [[uniqCheck]] = await db.query(`
      SELECT COUNT(*) AS cnt FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'lis_participants' AND indexname = 'uniq_lis_participants_phone'
    `);
    if (uniqCheck.cnt === 0) {
      await db.query(`CREATE UNIQUE INDEX uniq_lis_participants_phone ON lis_participants(phone)`);
      console.log('✅ Added unique index on lis_participants.phone (prevents duplicate-phone registrations)');
    }
  } catch (e) {
    console.log('⚠️  Could not add unique index on lis_participants.phone — likely existing duplicate phone numbers in the data. Duplicate registration is still blocked at the application level via a locked read, but not yet DB-enforced. Resolve the conflicting rows and restart to apply the hard constraint:', e.message);
  }
})();

// Looks up the existing patient for the friendly "already exists" response — shared by
// both the pre-insert check and the duplicate-key fallback below.
async function findByPhone(phone, replacementsFn = db.query) {
  const [existing] = await replacementsFn(
    `SELECT id, participant_number, first_name, last_name, gender, date_of_birth, phone, residence, study_ref,
       EXISTS(SELECT 1 FROM lis_test_orders o WHERE o.participant_id = lis_participants.id AND o.status != 'closed') AS is_queued
     FROM lis_participants WHERE phone = ? LIMIT 1`,
    { replacements: [phone] }
  );
  return existing[0] || null;
}

router.post('/participants', authorize('lis.participants.create'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { first_name, last_name, gender, date_of_birth, phone, residence, study_ref, demographics, doctor_id, consultant_id, room_number, clinic_id, clinic_name } = req.body;
  const id = uuidv4();
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const participant_number = `PTN-${dateStr}-${randomSuffix}`;
  const cleanPhone = phone && phone.trim() ? phone.trim() : null;
  const branchId = getCreateBranchId(req);

  const attemptRegister = async () => {
  const t = await db.transaction();
  try {
    // Locking the phone value for the rest of this transaction closes the same check-
    // then-insert race found in billing/inpatient: without it, two concurrent
    // registrations for the same phone both read "no existing match" before either
    // commits. `FOR UPDATE` on an indexed equality lookup takes a row lock when a match
    // exists, or a gap lock when it doesn't (InnoDB, REPEATABLE READ) — either way a
    // concurrent transaction trying to claim the same phone blocks until this one
    // finishes, instead of racing past it.
    if (cleanPhone) {
      const [existing] = await db.query(
        `SELECT id, participant_number, first_name, last_name, gender, date_of_birth, phone, residence, study_ref,
           EXISTS(SELECT 1 FROM lis_test_orders o WHERE o.participant_id = lis_participants.id AND o.status != 'closed') AS is_queued
         FROM lis_participants WHERE phone = ? FOR UPDATE`,
        { replacements: [cleanPhone], transaction: t }
      );
      if (existing.length) {
        await t.rollback();
        return res.status(409).json({
          success: false,
          error: 'duplicate_phone',
          message: `A patient with this phone number already exists: ${existing[0].first_name} ${existing[0].last_name}`,
          patient: existing[0],
        });
      }
    }

    // Secondary check for the common case of no phone (or a different phone) but the same
    // person — a walk-in with no phone on file, or one typo'd differently the second time.
    // Deliberately a soft prompt (frontend shows the same "already exists?" dialog, staff
    // can still proceed), not a hard DB constraint — unlike phone, two genuinely different
    // people sharing both a full name and date of birth is rare but real, so this must
    // never silently block a legitimate registration the way the phone uniqueness does.
    if (first_name && last_name && date_of_birth) {
      const [nameDobMatch] = await db.query(
        `SELECT id, participant_number, first_name, last_name, gender, date_of_birth, phone, residence, study_ref,
           EXISTS(SELECT 1 FROM lis_test_orders o WHERE o.participant_id = lis_participants.id AND o.status != 'closed') AS is_queued
         FROM lis_participants
         WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND date_of_birth = ?
         FOR UPDATE`,
        { replacements: [first_name, last_name, date_of_birth], transaction: t }
      );
      if (nameDobMatch.length) {
        await t.rollback();
        return res.status(409).json({
          success: false,
          error: 'duplicate_name_dob',
          message: `A patient with this name and date of birth already exists: ${nameDobMatch[0].first_name} ${nameDobMatch[0].last_name}`,
          patient: nameDobMatch[0],
        });
      }
    }

    await db.query(
      `INSERT INTO lis_participants (id, participant_number, first_name, last_name, gender, date_of_birth, phone, residence, study_ref, demographics, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      {
        // Every optional field needs an explicit `|| null`: Sequelize throws
        // ("Positional replacement (?) N has no entry in the replacement map")
        // on an `undefined` replacement rather than sending NULL, so a caller
        // that simply omits a field breaks the whole insert. gender was the
        // one field here missing that fallback, which is why pharmacy
        // dispensing's walk-in registration — the only caller that posts just
        // first_name/last_name — 500'd while the LIS registration form (which
        // always sends a gender) worked fine.
        replacements: [id, participant_number, first_name, last_name, gender || null, date_of_birth || null, cleanPhone, residence || null, study_ref || null, JSON.stringify(demographics || {}), branchId],
        transaction: t
      }
    );

    // Only create a queue entry if the user actually chose to queue at registration time
    // (selected a clinic or doctor) — otherwise every fresh registration would show as "Queued".
    let queuedVisitId = null;
    if (clinic_id || doctor_id || consultant_id) {
      queuedVisitId = uuidv4();
      await db.query(
        `INSERT INTO lis_test_orders (id, participant_id, doctor_id, consultant_id, room_number, clinic_id, clinic_name, status, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`,
        { replacements: [queuedVisitId, id, doctor_id || null, consultant_id || null, room_number || null, clinic_id || null, clinic_name || null, branchId], transaction: t }
      );
    }

    await t.commit();

    // Same notification gap as /participants/:id/queue below, but for the far more common
    // path: registering and queuing in one step from the registration form. Non-blocking,
    // after commit — a notification failure must never surface as a failed registration.
    if (queuedVisitId) {
      try {
        const { notifyUser, notifyRole } = require('../services/notificationService');
        const patientName = `${first_name} ${last_name}`.trim();
        if (doctor_id) {
          await notifyUser(db, {
            clinic_id: req.user?.clinicId, user_id: doctor_id,
            type: 'patient_queued', title: 'New patient queued',
            message: `${patientName} has been queued for you${clinic_name ? ` at ${clinic_name}` : ''}`,
            entity_type: 'LisTestOrder', entity_id: queuedVisitId, link: '/lis/queue',
          });
        } else {
          await notifyRole(db, {
            clinic_id: req.user?.clinicId, role: 'doctor', branch_id: req.user?.branchId,
            type: 'patient_queued', title: 'New patient queued',
            message: `${patientName} has been added to the consultation queue`,
            entity_type: 'LisTestOrder', entity_id: queuedVisitId, link: '/lis/queue',
          });
        }
      } catch (e) { /* non-blocking */ }
    }

    res.status(201).json({ success: true, id, message: 'Participant registered successfully' });
  } catch (error) {
    if (!t.finished) await t.rollback().catch(() => {});
    // Three-way (or more) contention on the same phone's FOR UPDATE gap lock can
    // legitimately deadlock against itself in InnoDB — confirmed by firing 3 concurrent
    // registrations for the same phone. Let the caller retry once instead of surfacing a
    // 500 to whichever request lost the deadlock arbitration; every other error is
    // handled here and returned as-is.
    if (error.original?.code === 'ER_LOCK_DEADLOCK') {
      throw error;
    }
    console.error('Error registering participant:', error);
    // Belt-and-suspenders: if the unique index on phone is active (see migration above)
    // and somehow a duplicate still reached the INSERT — e.g. two connections racing at
    // the gap-lock boundary — translate the DB-level rejection into the same friendly
    // "already exists" response instead of a generic 500.
    if (isUniqueViolation(error) && /phone/i.test(error.original?.detail || error.original?.sqlMessage || '')) {
      const existing = cleanPhone ? await findByPhone(cleanPhone).catch(() => null) : null;
      return res.status(409).json({
        success: false,
        error: 'duplicate_phone',
        message: existing ? `A patient with this phone number already exists: ${existing.first_name} ${existing.last_name}` : 'A patient with this phone number already exists',
        patient: existing,
      });
    }
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, error: 'Participant number already exists' });
    }
    res.status(500).json({ success: false, error: 'Database error' });
  }
  };

  try {
    await attemptRegister();
  } catch (error) {
    if (error.original?.code !== 'ER_LOCK_DEADLOCK') {
      console.error('Unexpected error registering participant:', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    try {
      await attemptRegister();
    } catch (retryError) {
      console.error('Error registering participant (after deadlock retry):', retryError);
      res.status(500).json({ success: false, error: 'Database error' });
    }
  }
});

// The LIMIT 100 with no search param meant the registry was only ever browsable for a
// facility's most recent 100 registrations — the frontend's search box only filtered
// within whatever this endpoint happened to return, not the full patient database. A
// facility clears 100 total registrations almost immediately, after which older patients
// become permanently unfindable here. `search` now matches server-side against name,
// participant number, and phone; LIMIT still applies (raised to 200) but only as a page
// size, not as the entire searchable universe.
router.get('/participants', authorize('lis.participants.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { search } = req.query;
    // ILIKE, not LIKE. MySQL's LIKE ignores case; PostgreSQL's does not, so
    // searching "james" found nothing for a participant stored as "James".
    const branchFilter = getBranchConditionSQL(req, 'p');
    const conditions = [];
    const replacements = [];
    if (search) {
      conditions.push(`(p.first_name ILIKE ? OR p.last_name ILIKE ? OR p.participant_number ILIKE ? OR p.phone ILIKE ?)`);
      replacements.push(...Array(4).fill(`%${search}%`));
    }
    if (branchFilter.sql) {
      // branchFilter.sql is ` AND alias.branch_id = ?` — strip the leading " AND " since
      // it's being folded into `conditions` and joined with AND below rather than appended
      // after an existing WHERE.
      conditions.push(branchFilter.sql.replace(/^\s*AND\s*/, ''));
      replacements.push(...branchFilter.params);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // The cap was 200, applied to every request and ordered newest-first, while
    // the patient pickers fetch this list once with no search and filter what
    // comes back in the browser. On a tenant with 347 people registered through
    // the LIS — and none in the patient registry — the 147 oldest could not be
    // selected anywhere: the picker answered "No matching patients" for someone
    // who was plainly registered.
    //
    // A cap still exists, because an unbounded list would eventually be worse.
    // Anything approaching it should pass ?search= and let the database do the
    // matching rather than relying on what happens to fit.
    const LIMIT = parseInt(process.env.LIS_PARTICIPANT_LIMIT || '2000', 10);

    // is_queued covers every non-closed status ('waiting', 'called', 'ordered'), not just
    // the queue-stage ones — a patient a doctor has already started seeing (status
    // 'ordered') still has an active visit and must not look selectable for a fresh
    // "Queue on Registration" here just because they've moved past the waiting room.
    //
    // The active_visit_* columns exist so the registration screen can actually say what
    // "already has an active visit" means (which doctor, which room, since when) instead
    // of just refusing to let reception queue them again with no explanation.
    const [participants] = await db.query(`
      SELECT p.*,
        EXISTS(
          SELECT 1 FROM lis_test_orders o
          WHERE o.participant_id = p.id AND o.status != 'closed'
        ) AS is_queued,
        av.status AS active_visit_status,
        av.room_number AS active_visit_room,
        av.doctor_name AS active_visit_doctor,
        av.created_at AS active_visit_since
      FROM lis_participants p
      LEFT JOIN LATERAL (
        SELECT o.status, o.room_number, o.created_at,
          COALESCE(u.display_name, ce.first_name || ' ' || ce.last_name) AS doctor_name
        FROM lis_test_orders o
        LEFT JOIN users u ON u.id = o.doctor_id
        LEFT JOIN employees ce ON ce.id = o.consultant_id
        WHERE o.participant_id = p.id AND o.status != 'closed'
        ORDER BY o.created_at DESC
        LIMIT 1
      ) av ON true
      ${where}
      ORDER BY p.created_at DESC LIMIT ${LIMIT}
    `, { replacements });
    res.json(participants.map(p => ({ ...p, demographics: parseJSONField(p.demographics, {}) })));
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.put('/participants/:id', authorize('lis.registration.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { first_name, last_name, gender, date_of_birth, phone, residence, study_ref, demographics } = req.body;
  try {
    await db.query(
      `UPDATE lis_participants SET first_name = ?, last_name = ?, gender = ?, date_of_birth = ?, phone = ?, residence = ?, study_ref = ?, demographics = ?
       WHERE id = ?`,
      {
        replacements: [
          first_name, last_name, gender, date_of_birth || null, phone || null, residence || null,
          study_ref || null, JSON.stringify(demographics || {}), id,
        ],
      }
    );
    res.json({ success: true, message: 'Participant updated successfully' });
  } catch (error) {
    console.error('Error updating participant:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/participants/:id/queue', authorize('lis.queue.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { doctor_id, consultant_id, room_number, clinic_id, clinic_name } = req.body;
  try {
    const visitId = uuidv4();
    await db.query(
      `INSERT INTO lis_test_orders (id, participant_id, doctor_id, consultant_id, room_number, clinic_id, clinic_name, status, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`,
      { replacements: [visitId, id, doctor_id || null, consultant_id || null, room_number || null, clinic_id || null, clinic_name || null, getCreateBranchId(req)] }
    );

    // This is the actual "queue a patient to a doctor" path this app uses today
    // (lis_test_orders, not the older patient_queue table) — it had no notification
    // at all, so a doctor never learned a patient was waiting until they happened to
    // open the queue screen. Non-blocking, and note clinic_id here is the *tenant's*
    // clinic_id (req.user?.clinicId) — req.body's clinic_id/clinic_name is the
    // destination department (e.g. "GP"), an unrelated UUID, not a notification target.
    try {
      const { notifyUser, notifyRole } = require('../services/notificationService');
      const [[participant]] = await db.query(
        `SELECT first_name, last_name FROM lis_participants WHERE id = ?`,
        { replacements: [id] }
      );
      const patientName = participant ? `${participant.first_name} ${participant.last_name}`.trim() : 'A patient';
      if (doctor_id) {
        await notifyUser(db, {
          clinic_id: req.user?.clinicId, user_id: doctor_id,
          type: 'patient_queued', title: 'New patient queued',
          message: `${patientName} has been queued for you${clinic_name ? ` at ${clinic_name}` : ''}`,
          entity_type: 'LisTestOrder', entity_id: visitId, link: '/lis/queue',
        });
      } else {
        await notifyRole(db, {
          clinic_id: req.user?.clinicId, role: 'doctor', branch_id: req.user?.branchId,
          type: 'patient_queued', title: 'New patient queued',
          message: `${patientName} has been added to the consultation queue`,
          entity_type: 'LisTestOrder', entity_id: visitId, link: '/lis/queue',
        });
      }
    } catch (e) { /* non-blocking */ }

    res.json({ success: true, message: 'Participant queued to doctor successfully' });
  } catch (error) {
    console.error('Error queuing participant:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// A previous pass tried to scope this to "the terminal's own clinic" by filtering
// o.clinic_id against the caller's facility/tenant clinic_id (an int like 1). That's a
// false cognate: lis_test_orders.clinic_id/clinic_name is actually which *destination
// clinic/department* (from dr_clinics, e.g. "GP - Consultation") the patient was queued
// to see — a UUID, never equal to the tenant clinic_id — so that filter silently excluded
// every real queued patient the moment a caller passed clinic_id, which is exactly what
// LISQueue.tsx started doing. The clinic_id query param is accepted but ignored — kept
// only so older callers passing it don't break. Branch scoping (below) now uses
// lis_test_orders.branch_id instead, added in a later migration for exactly this purpose.
router.get('/queue', authorize('lis.queue.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const branchFilter = getBranchConditionSQL(req, 'o');
    const [queue] = await db.query(`
      SELECT o.id as order_id, o.doctor_id, o.consultant_id, o.room_number, o.clinic_id, o.clinic_name, o.status, o.created_at, o.updated_at,
             o.vitals, o.triaged_by, o.triaged_at,
             p.id as participant_id, p.participant_number, p.first_name, p.last_name, p.gender,
             COALESCE(u.display_name, ce.first_name || ' ' || ce.last_name) as doctor_name, tu.display_name as triaged_by_name
      FROM lis_test_orders o
      JOIN lis_participants p ON o.participant_id = p.id
      LEFT JOIN users u ON o.doctor_id = u.id
      LEFT JOIN employees ce ON ce.id = o.consultant_id
      LEFT JOIN users tu ON o.triaged_by = tu.id
      WHERE o.status IN ('waiting', 'called')
      ${branchFilter.sql}
      ORDER BY o.created_at ASC
    `, { replacements: branchFilter.params });
    res.json(queue.map(q => ({ ...q, vitals: parseJSONField(q.vitals, {}) })));
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Natural-sounding (not robotic) voice for the queue display's "Patient X, please
// proceed to..." calls — the browser's own speechSynthesis voices are universally
// synthetic-sounding and vary by device/OS with no way to pick a good one reliably.
// ../utils/edgeTts calls Microsoft Edge's own neural "Read Aloud" voices directly
// from the server — free, no API key, genuinely natural. It's an unofficial use of
// that service (not a published public API), so it could need revisiting if
// Microsoft changes it, but it's the only free option that sounds like a real
// person rather than a screen reader. (This used to depend on the npm package
// `msedge-tts`, which ships a `preinstall: npx only-allow pnpm` script that broke
// the Render build — see edgeTts.js's own header comment for the full story.)
const { synthesize } = require('../utils/edgeTts');
const ANNOUNCEMENT_VOICE = 'en-US-GuyNeural';

router.post('/queue/announce', authorize('lis.queue.write'), async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.length > 300) {
    return res.status(400).json({ error: 'text is required (max 300 characters)' });
  }
  try {
    const audio = await synthesize(text, ANNOUNCEMENT_VOICE);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (error) {
    console.error('Error generating queue announcement audio:', error.message);
    res.status(502).json({ error: 'Voice service unavailable' });
  }
});

// Nurse triage — records vitals on a queued patient's order row before the doctor sees
// them, deliberately narrower than POST /orders (which also sets clinical_notes/status/
// doctor_id): only ever touches vitals + who/when triaged, so it can never clobber
// anything the doctor has already started, and can safely run before an order even has a
// doctor assigned.
router.put('/orders/:id/triage', authorize('lis.triage.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { vitals } = req.body;
  try {
    const [[order]] = await db.query(`SELECT status FROM lis_test_orders WHERE id = ?`, { replacements: [id] });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'closed') {
      return res.status(409).json({ success: false, error: 'This visit is closed and can no longer be triaged.' });
    }
    await db.query(
      `UPDATE lis_test_orders SET vitals = ?, triaged_by = ?, triaged_at = NOW(), updated_at = NOW() WHERE id = ?`,
      { replacements: [JSON.stringify(vitals || {}), req.user?.id || null, id] }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving triage:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// MySQL's affectedRows (without the CLIENT_FOUND_ROWS connection flag, which this app
// doesn't set) reflects rows actually *changed*, not rows *matched* — so relying on it to
// distinguish "no such id" from "id exists, nothing to change" produces a false 404 on any
// legitimate no-op resave (e.g. saving the identical clinical notes twice, or two updates
// landing within the same second so even `updated_at = NOW()` doesn't visibly change).
// Confirmed live while testing the affectedRows approach first. An explicit existence
// check avoids the ambiguity entirely.
async function orderExists(db, id) {
  const [[row]] = await db.query('SELECT id FROM lis_test_orders WHERE id = ?', { replacements: [id] });
  return !!row;
}

router.post('/queue/:id/call', authorize('lis.queue.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  try {
    if (!(await orderExists(db, id))) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    await db.query(`UPDATE lis_test_orders SET status = 'called', updated_at = NOW() WHERE id = ?`, { replacements: [id] });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Doctor updates the clinical notes (e.g. adding a diagnosis) from the Visit Summary view.
router.put('/orders/:id/notes', authorize('lis.clinical.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { clinical_notes } = req.body;
  try {
    if (!(await orderExists(db, id))) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const [[order]] = await db.query(`SELECT status FROM lis_test_orders WHERE id = ?`, { replacements: [id] });
    if (order?.status === 'closed') {
      return res.status(409).json({ success: false, error: 'This visit is closed — start a new visit to add or edit notes.' });
    }
    await db.query(`UPDATE lis_test_orders SET clinical_notes = ?, updated_at = NOW() WHERE id = ?`, { replacements: [clinical_notes, id] });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Doctor closes out a visit episode from the Visit Summary view — final state, distinct
// from 'waiting'/'called'/'ordered' so it's clearly done with (still shown in the summary
// history, just marked closed).
router.put('/orders/:id/close', authorize('lis.clinical.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  try {
    if (!(await orderExists(db, id))) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    await db.query(`UPDATE lis_test_orders SET status = 'closed', updated_at = NOW() WHERE id = ?`, { replacements: [id] });

    try {
      const [[order]] = await db.query(
        `SELECT p.first_name, p.last_name, p.participant_number FROM lis_test_orders o
         JOIN lis_participants p ON p.id = o.participant_id WHERE o.id = ?`,
        { replacements: [id] }
      );
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Clinical', action: 'VISIT_CLOSED', entity_type: 'LisTestOrder', entity_id: id,
        description: order ? `Visit closed for ${order.first_name} ${order.last_name} (${order.participant_number})` : `Visit closed (order ${id})`,
        ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ==========================================
// 1b. Visit Diagnoses (ICD-10 coded, or free-text "custom")
// ==========================================
// Business rules live in services/visitDiagnosesService.js (duplicate
// checks, closed-visit rule, primary auto-reassignment, the clinical_notes
// "Diagnosis: ..." append) so they're directly testable without Express.
const visitDiagnosesService = require('../services/visitDiagnosesService');

router.get('/orders/:id/diagnoses', authorize('lis.clinical.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  try {
    if (!(await orderExists(db, id))) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json(await visitDiagnosesService.listVisitDiagnoses(db, id));
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/orders/:id/diagnoses', authorize('lis.clinical.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { icd_code, icd_source, icd_version, description, custom_diagnosis_id } = req.body;
  try {
    const result = await visitDiagnosesService.addVisitDiagnosis(db, {
      orderId: id, icdCode: icd_code, icdSource: icd_source, icdVersion: icd_version,
      description, customDiagnosisId: custom_diagnosis_id, userId: req.user?.id, fallbackBranchId: getCreateBranchId(req),
    });
    if (result.status >= 400) return res.status(result.status).json({ success: false, error: result.error });
    res.status(201).json(result.diagnosis);
  } catch (error) {
    console.error('Error adding visit diagnosis:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.put('/orders/:id/diagnoses/:diagnosisId/primary', authorize('lis.clinical.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id, diagnosisId } = req.params;
  try {
    const result = await visitDiagnosesService.setPrimaryDiagnosis(db, { orderId: id, diagnosisId });
    if (result.status >= 400) return res.status(result.status).json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.delete('/orders/:id/diagnoses/:diagnosisId', authorize('lis.clinical.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id, diagnosisId } = req.params;
  try {
    const result = await visitDiagnosesService.removeVisitDiagnosis(db, { orderId: id, diagnosisId, userId: req.user?.id });
    if (result.status >= 400) return res.status(result.status).json({ success: false, error: result.error });

    try {
      const rr = require('./reports');
      await rr.logAudit({ req,
        user_id: req.user?.id, user_name: req.user?.displayName || req.user?.email, user_role: req.user?.role,
        module: 'Clinical', action: 'DIAGNOSIS_REMOVED', entity_type: 'VisitDiagnosis', entity_id: diagnosisId,
        description: `Removed diagnosis "${result.removed.description}" from visit ${id}`, ip_address: req.ip, status: 'success',
      });
    } catch (e) {}

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ==========================================
// 2. Test Orders
// ==========================================
router.post('/orders', authorize('lis.clinical.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { participant_id, visit_id, doctor_id, clinical_notes, vitals, tests, order_id } = req.body;
  
  const t = await db.transaction();
  let orderId = order_id;

  try {
    if (orderId) {
      await db.query(
        `UPDATE lis_test_orders
         SET clinical_notes = ?, vitals = ?, status = 'ordered', doctor_id = COALESCE(doctor_id, ?)
         WHERE id = ?`,
        { replacements: [clinical_notes || null, JSON.stringify(vitals || {}), doctor_id || null, orderId], transaction: t }
      );
    } else {
      orderId = uuidv4();
      await db.query(
        `INSERT INTO lis_test_orders (id, participant_id, visit_id, doctor_id, clinical_notes, vitals, status, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, 'ordered', ?)`,
        { replacements: [orderId, participant_id, visit_id || null, doctor_id || null, clinical_notes || null, JSON.stringify(vitals || {}), getCreateBranchId(req)], transaction: t }
      );
    }
    
    // One physical draw covers every test in the order, so they all share a
    // single barcode. If tests are being appended to an order that already
    // has specimens, reuse its existing barcode instead of minting a new one.
    let barcode;
    if (order_id) {
      const [[existing]] = await db.query(
        `SELECT barcode FROM lis_specimens WHERE order_id = ? LIMIT 1`,
        { replacements: [order_id], transaction: t }
      );
      barcode = existing?.barcode;
    }
    if (!barcode) {
      barcode = Math.floor(1000000 + Math.random() * 9000000).toString();
    }

    // Guards against the same test being ordered (and billed) twice for one visit — e.g.
    // a doctor resubmitting the order form because a prior submission's confirmation
    // wasn't seen, or re-selecting a test that's already awaiting collection. Scoped to
    // "this participant's still-open visit" (order.status != 'closed'), not "ever" —
    // a genuine follow-up/repeat test ordered after the earlier one was collected, or in
    // a brand-new visit, is a legitimate second order and must still go through.
    const skipped = [];
    for (const test of (tests || [])) {
      if (test.code) {
        const [[dup]] = await db.query(
          `SELECT sp.id FROM lis_specimens sp
           JOIN lis_test_orders o ON o.id = sp.order_id
           WHERE o.participant_id = ? AND o.status != 'closed'
             AND sp.test_code = ? AND sp.status = 'pending_collection'
           LIMIT 1`,
          { replacements: [participant_id, test.code], transaction: t }
        );
        if (dup) {
          skipped.push(test.name || test.code);
          continue;
        }
      }

      const specimenId = uuidv4();
      await db.query(
        `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, department, status, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_collection', ?)`,
        { replacements: [specimenId, orderId, test.code || null, test.name || null, barcode, test.department || null, getCreateBranchId(req)], transaction: t }
      );
    }

    await t.commit();

    // Notify lab staff — non-blocking, and after commit so a notification
    // failure can never roll back an order that actually succeeded. Skipped
    // entirely when no tests were ordered (a doctor saving vitals/notes/a
    // prescription with no lab work attached) — there is nothing for the lab
    // to do, so "tests requested" would be a false alarm.
    if ((tests || []).length > 0) {
      try {
        const { notifyRole } = require('../services/notificationService');
        const [[participant]] = await db.query(
          `SELECT first_name, last_name FROM lis_participants WHERE id = ?`,
          { replacements: [participant_id] }
        );
        const patientName = participant ? `${participant.first_name} ${participant.last_name}`.trim() : 'a patient';
        const testNames = tests.map(t2 => t2.name || t2.code).filter(Boolean).join(', ') || 'tests';
        await notifyRole(db, {
          clinic_id: req.user?.clinicId, role: 'lab', branch_id: req.user?.branchId,
          type: 'lab_test_requested', title: 'New lab test requested',
          message: `${testNames} requested for ${patientName}`,
          entity_type: 'LisTestOrder', entity_id: orderId, link: '/lis/orders',
        });
      } catch (e) { /* non-blocking */ }
    }

    res.status(201).json({ success: true, order_id: orderId, message: 'Order and specimens created', skipped_duplicates: skipped });
  } catch (error) {
    await t.rollback();
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// Appends more lab tests to an existing order — used from Visit Summary's "Request Another
// Service" so a doctor can order a confirmatory/follow-up test on the same visit without
// leaving it. Deliberately narrower than POST /orders (which also unconditionally overwrites
// clinical_notes/vitals and forces status back to 'ordered' whenever order_id is passed) —
// this only ever inserts lis_specimens rows, so it can never wipe the visit's existing notes
// or silently reopen a closed visit.
router.post('/orders/:id/add-tests', authorize('lis.clinical.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { tests } = req.body;
  if (!tests || tests.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one test is required' });
  }

  const t = await db.transaction();
  try {
    const [[order]] = await db.query(`SELECT id, participant_id, status, branch_id FROM lis_test_orders WHERE id = ?`, { replacements: [id], transaction: t });
    if (!order) {
      await t.rollback();
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (order.status === 'closed') {
      await t.rollback();
      return res.status(409).json({ success: false, error: 'This visit is closed — start a new visit to request more tests or services.' });
    }

    // Same one-draw-one-barcode convention as POST /orders.
    const [[existing]] = await db.query(`SELECT barcode FROM lis_specimens WHERE order_id = ? LIMIT 1`, { replacements: [id], transaction: t });
    const barcode = existing?.barcode || Math.floor(1000000 + Math.random() * 9000000).toString();

    const skipped = [];
    let created = 0;
    for (const test of tests) {
      if (test.code) {
        const [[dup]] = await db.query(
          `SELECT sp.id FROM lis_specimens sp
           JOIN lis_test_orders o ON o.id = sp.order_id
           WHERE o.participant_id = ? AND o.status != 'closed'
             AND sp.test_code = ? AND sp.status = 'pending_collection'
           LIMIT 1`,
          { replacements: [order.participant_id, test.code], transaction: t }
        );
        if (dup) { skipped.push(test.name || test.code); continue; }
      }
      const specimenId = uuidv4();
      await db.query(
        `INSERT INTO lis_specimens (id, order_id, test_code, test_name, barcode, department, status, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_collection', ?)`,
        { replacements: [specimenId, id, test.code || null, test.name || null, barcode, test.department || null, order.branch_id || getCreateBranchId(req)], transaction: t }
      );
      created++;
    }

    await t.commit();
    res.status(201).json({ success: true, created, skipped_duplicates: skipped });
  } catch (error) {
    await t.rollback();
    console.error('Error adding tests to order:', error);
    res.status(500).json({ success: false, error: 'Failed to add tests' });
  }
});

router.get('/orders', authorize('lis.clinical.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const branchFilter = getBranchConditionSQL(req, 'o');
    const [orders] = await db.query(`
      SELECT o.*, p.first_name, p.last_name, p.participant_number
      FROM lis_test_orders o
      JOIN lis_participants p ON o.participant_id = p.id
      WHERE 1=1 ${branchFilter.sql}
      ORDER BY o.created_at DESC
    `, { replacements: branchFilter.params });
    res.json(orders.map(o => ({ ...o, vitals: parseJSONField(o.vitals, {}) })));
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Per-patient visit summary — used by the doctor's "Visit Summary" view on /lis/orders to
// see everything done for a patient at a glance: vitals, complaints, notes, and every
// ordered test with its current lab status.
//
// created_at is stored in UTC, so filtering "today" (or any specific day) is done on the
// client by converting each order's timestamp through the browser's local Date object,
// the same fix applied to the Patient Bills date filter — a raw server-side
// `DATE(created_at) = :date` comparison against a browser-local date string would wrongly
// exclude visits from the first few hours of the local day. This endpoint just returns a
// bounded recent window (last 90 days) for the frontend to group/filter by local day.
router.get('/visit-summaries', authorize('lis.clinical.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { participant_id } = req.query;
    const replacements = {};
    let filter = " AND o.created_at >= ((now() AT TIME ZONE 'utc') - INTERVAL '90 day')";
    if (participant_id) {
      filter += ' AND o.participant_id = :participantId';
      replacements.participantId = participant_id;
    }
    const branchFilter = getBranchConditionNamed(req, 'o');
    filter += branchFilter.sql;
    Object.assign(replacements, branchFilter.replacements);

    const [orders] = await db.query(`
      SELECT o.id as order_id, o.participant_id, o.doctor_id, o.consultant_id, o.clinical_notes, o.vitals,
             o.status, o.room_number, o.clinic_id, o.clinic_name, o.created_at, o.updated_at,
             p.participant_number, p.first_name, p.last_name, p.gender, p.date_of_birth, p.phone,
             COALESCE(u.display_name, ce.first_name || ' ' || ce.last_name) as doctor_name
      FROM lis_test_orders o
      JOIN lis_participants p ON o.participant_id = p.id
      LEFT JOIN users u ON o.doctor_id = u.id
      LEFT JOIN employees ce ON ce.id = o.consultant_id
      WHERE 1=1 ${filter}
      ORDER BY o.created_at DESC
      LIMIT 1000
    `, { replacements });

    const orderIds = orders.map(o => o.order_id);
    let specimens = [];
    if (orderIds.length > 0) {
      [specimens] = await db.query(`
        SELECT id, order_id, test_code, test_name, department, status, updated_at
        FROM lis_specimens
        WHERE order_id IN (:orderIds)
      `, { replacements: { orderIds } });
    }

    const specimensByOrder = {};
    for (const s of specimens) {
      if (!specimensByOrder[s.order_id]) specimensByOrder[s.order_id] = [];
      specimensByOrder[s.order_id].push(s);
    }

    // Prescriptions have no FK back to a specific lis_test_orders row (pharmacy_prescriptions
    // .visit_id refers to the separate general `visits` table, not this one) — matched here
    // by patient + same calendar day as the order instead, the same best-effort approach
    // used elsewhere in this app where no strict FK exists (e.g. billing line reconciliation
    // by name+quantity). Good enough for a same-day visit summary; a patient with two
    // genuinely separate visits on the same day would see prescriptions from both.
    const participantIds = [...new Set(orders.map(o => o.participant_id))];
    let prescriptionLines = [];
    if (participantIds.length > 0) {
      [prescriptionLines] = await db.query(`
        SELECT pp.id as prescription_id, pp.patient_id, pp.prescription_number, pp.prescription_date, pp.status as prescription_status,
               pl.id as line_id, pl.quantity_prescribed, pl.unit_of_measure, pl.dose_strength, pl.frequency, pl.duration_days, pl.status as line_status,
               pl.is_external, pl.external_drug_name, pl.dose_amount, pl.notes as line_notes,
               -- An external line has no inventory row, so its name lives on
               -- the line itself; COALESCE keeps one column for both kinds.
               COALESCE(ii.item_name, pl.external_drug_name) as drug_name
        FROM pharmacy_prescriptions pp
        JOIN prescription_lines pl ON pl.prescription_id = pp.id
        LEFT JOIN inventory_items ii ON pl.drug_id = ii.id
        WHERE pp.patient_id IN (:participantIds) AND pp.status != 'cancelled' AND pl.status != 'cancelled'
        ORDER BY pp.prescription_date DESC, pl.line_number ASC
      `, { replacements: { participantIds } });
    }

    const summaries = orders.map(o => {
      const tests = specimensByOrder[o.order_id] || [];
      const orderDay = new Date(o.created_at).toISOString().split('T')[0];
      const prescriptions = prescriptionLines.filter(pl =>
        pl.patient_id === o.participant_id && new Date(pl.prescription_date).toISOString().split('T')[0] === orderDay
      );
      return {
        ...o,
        vitals: parseJSONField(o.vitals, {}),
        tests,
        tests_total: tests.length,
        tests_ready: tests.filter(t => t.status === 'approved').length,
        prescriptions,
      };
    });

    res.json(summaries);
  } catch (error) {
    console.error('Error fetching visit summaries:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ==========================================
// 3. Specimen Collection & QC
// ==========================================

// A patient with several tests ordered together can pay for some and not others — the
// balance gate used to be all-or-nothing per patient (any unpaid line blocked every
// specimen), so this resolves collectibility per specimen instead. Matches by test name
// against bill.services[].serviceName — the same name lab test orders are billed under
// (see LISTestOrders.tsx: `serviceName: t.test_name`) — since specimens have no direct FK
// to a bill line. A line is "covered" if it belongs to a bill that's itself scheme-priced
// (the whole bill is claimed via a later insurer invoice, never blocks — same rule as the
// patient-level insurance_balance exclusion above), if it's been paid directly, or if it's
// individually insurance-priced even on an otherwise-cash bill (schemePrice stashed,
// unitPrice 0). One matching bill line is consumed per specimen so, e.g., 2 of 3 "Complete
// Blood Count" specimens paid for only unlocks 2 of them, not all 3.
//
// An inpatient lab request (routes/inpatient.js's POST /lab-requests) bills under
// "Lab Test — <name>", not the bare test name outpatient orders use — so a paid inpatient
// lab charge never matched anything here and stayed stuck showing as unpaid/uncollectible
// forever, no matter how long ago it was actually paid. Stripping that one known prefix
// before keying the pool fixes every inpatient lab bill already on file the moment this
// deploys (this pool is recomputed live on every request, nothing to migrate) as well as
// every one billed from now on.
const INPATIENT_LAB_BILL_PREFIX = /^lab test\s*[—-]\s*/;
async function getCollectiblePool(db, patientId) {
  const [bills] = await db.query(
    `SELECT id, scheme_id, services FROM patient_bills WHERE patient_id = ? AND status != 'cancelled'`,
    { replacements: [patientId] }
  );
  const pool = new Map();
  for (const bill of bills) {
    let services = bill.services;
    if (typeof services === 'string') { try { services = JSON.parse(services); } catch { services = []; } }
    if (!Array.isArray(services)) continue;
    const billIsScheme = !!bill.scheme_id;
    for (const s of services) {
      if (s.isVoided) continue;
      const name = String(s.serviceName || '').toLowerCase().trim().replace(INPATIENT_LAB_BILL_PREFIX, '');
      if (!name) continue;
      const isIndividuallyInsured = s.schemePrice != null && (parseFloat(s.unitPrice) || 0) === 0;
      // A line billed at exactly 0 has nothing left to collect, full stop — true whether
      // it's scheme-priced, individually insured, or a plain cash line that just happens
      // to be free. Checked as its own condition (not folded into isIndividuallyInsured,
      // which also requires schemePrice to be set) so a genuinely zero-priced cash item
      // is never blocked waiting for a payment nobody will ever make.
      const isZeroPriced = (parseFloat(s.unitPrice) || 0) === 0;
      if (!(billIsScheme || s.paid || isIndividuallyInsured || isZeroPriced)) continue;
      pool.set(name, (pool.get(name) || 0) + 1);
    }
  }
  return pool;
}

// Consumes getCollectiblePool() against a patient's specimens in a fixed, deterministic
// order (oldest first) so the same specimen always resolves the same way regardless of
// which endpoint asks — the list view and the single-specimen collect action must agree.
//
// freeTenant (true only for the dpoc schema — see both call sites below) skips the whole
// pool match: every service at this facility is free, so a matching bill line may not even
// exist yet (billOrderItems only bills what's actually selected, and a front-desk workflow
// built around "nothing is ever paid for" has no reason to create one) — waiting for a bill
// line that was never going to appear left every specimen stuck on "Payment Required"
// forever. Scoped to this one tenant rather than turned into a general bypass, since every
// other tenant is a real paying facility where this gate is doing real work.
function markCollectible(specimensForPatient, pool, freeTenant = false) {
  for (const s of specimensForPatient) {
    if (freeTenant) { s.item_paid = true; continue; }
    const name = String(s.test_name || '').toLowerCase().trim();
    const remaining = pool.get(name) || 0;
    if (remaining > 0) {
      s.item_paid = true;
      pool.set(name, remaining - 1);
    } else {
      s.item_paid = false;
    }
  }
}

// Was gated on lis.specimen.write (admin/lab only) even though this is a pure
// read — the page that calls it, /lis/collection, only requires lis.results.read
// at the route level (App.tsx), which also covers doctors. A doctor opening the
// page to check their own just-ordered test got a silent 403 here (swallowed to
// an empty array by LISCollection.tsx's fetch, with no error shown), making
// "No pending collections" look like the test was never created at all. The
// sibling /specimens/history endpoint right below already uses lis.results.read
// for the same kind of listing — this now matches it. Writing/collecting a
// specimen (recording it as collected, entering results) still requires
// lis.specimen.write at those routes and at the /lis/results-entry page itself.
router.get('/specimens/pending', authorize('lis.results.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const branchFilter = getBranchConditionSQL(req, 's');
    const [specimens] = await db.query(`
      SELECT s.*, p.id AS participant_id, p.first_name, p.last_name, p.participant_number, o.created_at as order_time,
        COALESCE(u.display_name, ce.first_name || ' ' || ce.last_name) as requested_by_name,
        COALESCE((
          SELECT SUM(pb.balance_amount) FROM patient_bills pb
          WHERE pb.patient_id = p.id AND pb.status != 'cancelled' AND pb.scheme_id IS NULL
        ), 0) AS outstanding_balance,
        COALESCE((
          SELECT SUM(pb.balance_amount) FROM patient_bills pb
          WHERE pb.patient_id = p.id AND pb.status != 'cancelled' AND pb.scheme_id IS NOT NULL
        ), 0) AS insurance_balance
      FROM lis_specimens s
      JOIN lis_test_orders o ON s.order_id = o.id
      JOIN lis_participants p ON o.participant_id = p.id
      LEFT JOIN users u ON u.id = o.doctor_id
      LEFT JOIN employees ce ON ce.id = o.consultant_id
      WHERE s.status IN ('pending_collection', 'recollection_required', 'collected', 'in_transit', 'accepted', 'routed')
      ${branchFilter.sql}
      ORDER BY o.created_at ASC, s.created_at ASC, s.id ASC
    `, { replacements: branchFilter.params });

    const byPatient = new Map();
    for (const s of specimens) {
      if (!byPatient.has(s.participant_id)) byPatient.set(s.participant_id, []);
      byPatient.get(s.participant_id).push(s);
    }
    const freeTenant = req.tenantSchema === 'tenant_dpoc';
    for (const [patientId, list] of byPatient) {
      const pool = await getCollectiblePool(db, patientId);
      markCollectible(list, pool, freeTenant);
    }

    res.json(specimens);
  } catch (error) {
    console.error('Error fetching pending specimens:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/specimens/history', authorize('lis.results.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { dateFrom, dateTo } = req.query;
    const branchFilter = getBranchConditionSQL(req, 's');
    let sql = `
      SELECT s.*, p.first_name, p.last_name, p.participant_number, o.created_at as order_time,
        COALESCE(u.display_name, ce.first_name || ' ' || ce.last_name) as requested_by_name
      FROM lis_specimens s
      JOIN lis_test_orders o ON s.order_id = o.id
      JOIN lis_participants p ON o.participant_id = p.id
      LEFT JOIN users u ON u.id = o.doctor_id
      LEFT JOIN employees ce ON ce.id = o.consultant_id
      WHERE s.status IN ('analyzed', 'pending_manager_review', 'approved')
      ${branchFilter.sql}
    `;
    // COALESCE to created_at: MySQL stamped updated_at automatically via
    // `ON UPDATE current_timestamp()`, which PostgreSQL has no equivalent for.
    // Triggers now reproduce it, but a row whose updated_at is still NULL would
    // otherwise fail both bounds and vanish from history entirely rather than
    // just sorting oddly.
    const params = [...branchFilter.params];
    if (dateFrom) { sql += ` AND COALESCE(s.updated_at, s.created_at) >= ?`; params.push(`${dateFrom} 00:00:00`); }
    if (dateTo) { sql += ` AND COALESCE(s.updated_at, s.created_at) <= ?`; params.push(`${dateTo} 23:59:59`); }
    sql += ` ORDER BY COALESCE(s.updated_at, s.created_at) DESC LIMIT 500`;
    const [specimens] = await db.query(sql, { replacements: params });
    res.json(specimens);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/specimens/:id/collect', authorize('lis.specimen.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { collected_by } = req.body;

  try {
    // Frontend already blocks collection per-specimen on whether its own matching bill
    // line is paid, but that's bypassable via a direct API call — enforce it here too,
    // same pattern as the pharmacy dispensing gate. Re-derives the same per-patient,
    // per-specimen collectible pool getCollectiblePool()/markCollectible() build for
    // /specimens/pending, scoped to just this specimen's patient, so this specimen
    // resolves exactly the same way the list view showed it.
    const [[specimenRow]] = await db.query(
      `SELECT s.id, s.test_name, s.created_at, o.participant_id
       FROM lis_specimens s JOIN lis_test_orders o ON s.order_id = o.id
       WHERE s.id = ?`,
      { replacements: [id] }
    );
    if (!specimenRow) {
      return res.status(404).json({ success: false, error: 'Specimen not found' });
    }
    const [siblings] = await db.query(
      `SELECT s.id, s.test_name
       FROM lis_specimens s JOIN lis_test_orders o ON s.order_id = o.id
       WHERE o.participant_id = ?
         AND s.status IN ('pending_collection', 'recollection_required', 'collected', 'in_transit', 'accepted', 'routed')
       ORDER BY o.created_at ASC, s.created_at ASC, s.id ASC`,
      { replacements: [specimenRow.participant_id] }
    );
    const pool = await getCollectiblePool(db, specimenRow.participant_id);
    markCollectible(siblings, pool, req.tenantSchema === 'tenant_dpoc');
    const thisOne = siblings.find(s => s.id === id);
    if (!thisOne?.item_paid) {
      return res.status(402).json({
        success: false,
        error: 'This test has not been paid for yet — collect payment before proceeding.',
      });
    }

    // QC was removed from this app entirely (no page/route left in the nav) — it used to
    // be the step that took a specimen from in_transit, accepted it, and routed it to its
    // department, which is what actually made it appear in Results Entry (LISResultsEntry.tsx
    // only lists status = 'routed'). With QC gone, collecting alone left specimens stuck at
    // in_transit forever. Route straight to 'routed' here instead — department is already
    // known (set from the test catalog at order time, see the /orders insert above) — so a
    // collected specimen shows up in Results Entry immediately, no QC step in between.
    const nextStatus = 'routed';

    await db.query(
      `UPDATE lis_specimens SET status = ?, collected_by = ?, collection_time = NOW() WHERE id = ?`,
      { replacements: [nextStatus, collected_by || null, id] }
    );
    res.json({ success: true, status: nextStatus });
  } catch (error) {
    console.error('Error collecting specimen:', error);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/specimens/:id/dispatch', authorize('lis.specimen.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  try {
    await db.query(`UPDATE lis_specimens SET status = 'in_transit' WHERE id = ?`, { replacements: [id] });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/specimens/:id/qc', authorize('lis.specimen.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { action, reason, checked_by } = req.body;
  
  const qcId = uuidv4();
  const nextStatus = action === 'accepted' ? 'accepted' : 'recollection_required';
  
  const t = await db.transaction();
  try {
    await db.query(
      `INSERT INTO lis_specimen_qc (id, specimen_id, action, reason, checked_by, branch_id) VALUES (?, ?, ?, ?, ?, ?)`,
      { replacements: [qcId, id, action, reason || null, checked_by || null, getCreateBranchId(req)], transaction: t }
    );
    
    await db.query(
      `UPDATE lis_specimens SET status = ? WHERE id = ?`,
      { replacements: [nextStatus, id], transaction: t }
    );
    
    await t.commit();
    res.json({ success: true, status: nextStatus });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/specimens/:id/route', authorize('lis.specimen.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { department } = req.body;
  
  try {
    await db.query(
      `UPDATE lis_specimens SET department = ?, status = 'routed' WHERE id = ?`,
      { replacements: [department || null, id] }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});
// ==========================================
// 3.5. Simulation Endpoint (For Testing Without Analyzer)
// ==========================================
router.post('/specimens/:id/simulate', authorize('lis.specimen.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;

  const mockResults = [
    { name: 'WBC', value: (4 + Math.random() * 6).toFixed(1), unit: '10^9/L', ref: '4.0-10.0' },
    { name: 'RBC', value: (3.5 + Math.random() * 2).toFixed(2), unit: '10^12/L', ref: '3.5-5.5' },
    { name: 'HGB', value: (11 + Math.random() * 5).toFixed(1), unit: 'g/dL', ref: '11.0-16.0' }
  ];

  // Same branch-inheritance rule as the real result-entry endpoint above —
  // stamp the specimen's own branch, not the caller's.
  const [[specimen]] = await db.query(`SELECT branch_id FROM lis_specimens WHERE id = ?`, { replacements: [id] });
  const branchId = specimen?.branch_id ?? getCreateBranchId(req);

  const t = await db.transaction();
  try {
    for (const result of mockResults) {
      const resultId = uuidv4();
      await db.query(
        `INSERT INTO lis_results (id, specimen_id, test_code, analyte, value, unit, status, branch_id)
         VALUES (?, ?, 'SIMULATED', ?, ?, ?, 'pending_manager_review', ?)`,
        { replacements: [resultId, id, result.name, result.value, result.unit, branchId], transaction: t }
      );
    }
    
    await db.query(
      `UPDATE lis_specimens SET status = 'analyzed' WHERE id = ?`,
      { replacements: [id], transaction: t }
    );
    
    await t.commit();
    res.json({ success: true, message: 'Mock results injected' });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/specimens/:id/results', authorize('lis.results.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  try {
    const branchFilter = getBranchConditionSQL(req, 'r');
    const [results] = await db.query(
      `SELECT r.*, c.reference_range, c.display_order, rec_u.display_name as recorded_by_name, mgr_u.display_name as manager_review_by_name
       FROM lis_results r
       LEFT JOIN lab_tests t ON r.test_code = t.test_code AND (t.branch_id = r.branch_id OR t.branch_id IS NULL)
       LEFT JOIN lab_test_components c ON t.id = c.lab_test_id AND r.analyte = c.component_name
       LEFT JOIN users rec_u ON rec_u.id = r.recorded_by
       LEFT JOIN users mgr_u ON mgr_u.id = r.manager_review_by
       WHERE r.specimen_id = ?
       ${branchFilter.sql}`,
      { replacements: [id, ...branchFilter.params] }
    );
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ==========================================
// 3.6. Manual Result Entry
// ==========================================
router.post('/specimens/:id/results', authorize('lis.specimen.write'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { results, test_code } = req.body;
  // results is an array of { analyte, value, unit }
  const recordedBy = req.user?.id || null;
  // A result must carry the SAME branch as the specimen it belongs to, not
  // whichever branch the person entering it happens to be scoped to right
  // now — otherwise an admin (who sees every branch) or anyone acting across
  // branches stamps the result with their own context, and it silently
  // becomes invisible to everyone actually scoped to the specimen's real
  // branch (getBranchConditionSQL is a strict equality filter, not
  // NULL/mismatch-inclusive). Confirmed live: a specimen on branch 2 had
  // approved results stamped branch_id=1, so its own order's visit summary
  // showed "No results recorded" despite the results genuinely existing.
  const [[specimen]] = await db.query(`SELECT branch_id FROM lis_specimens WHERE id = ?`, { replacements: [id] });
  const branchId = specimen?.branch_id ?? getCreateBranchId(req);

  const t = await db.transaction();
  try {
    for (const result of results) {
      const resultId = uuidv4();
      await db.query(
        `INSERT INTO lis_results (id, specimen_id, test_code, analyte, value, unit, status, recorded_by, branch_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_manager_review', ?, ?)`,
        { replacements: [resultId, id, test_code, result.analyte, result.value, result.unit || '', recordedBy, branchId], transaction: t }
      );
    }
    
    await db.query(
      `UPDATE lis_specimens SET status = 'analyzed' WHERE id = ?`,
      { replacements: [id], transaction: t }
    );
    
    await t.commit();
    res.json({ success: true, message: 'Results saved successfully' });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// ==========================================
// 4. Lab Results (Manager Review)
// ==========================================
router.get('/results/pending-review', authorize('lis.results.review'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const branchFilter = getBranchConditionSQL(req, 'r');
    const [results] = await db.query(`
      SELECT r.*, c.reference_range, c.display_order, s.barcode, s.test_name, p.first_name, p.last_name, p.participant_number,
        o.id as order_id, o.created_at as order_time,
        COALESCE(req_u.display_name, req_ce.first_name || ' ' || req_ce.last_name) as requested_by_name, rec_u.display_name as recorded_by_name
      FROM lis_results r
      JOIN lis_specimens s ON r.specimen_id = s.id
      JOIN lis_test_orders o ON s.order_id = o.id
      JOIN lis_participants p ON o.participant_id = p.id
      LEFT JOIN lab_tests t ON r.test_code = t.test_code AND (t.branch_id = r.branch_id OR t.branch_id IS NULL)
      LEFT JOIN lab_test_components c ON t.id = c.lab_test_id AND r.analyte = c.component_name
      LEFT JOIN users req_u ON req_u.id = o.doctor_id
      LEFT JOIN employees req_ce ON req_ce.id = o.consultant_id
      LEFT JOIN users rec_u ON rec_u.id = r.recorded_by
      WHERE r.status = 'pending_manager_review'
      ${branchFilter.sql}
      ORDER BY r.created_at DESC
    `, { replacements: branchFilter.params });
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.get('/results/history', authorize('lis.results.read'), async (req, res) => {
  const { sequelize: db } = req.models;
  try {
    const { dateFrom, dateTo } = req.query;
    const branchFilter = getBranchConditionSQL(req, 'r');
    let sql = `
      SELECT r.*, c.reference_range, c.display_order, s.barcode, s.test_name, p.first_name, p.last_name, p.participant_number,
        o.id as order_id, o.created_at as order_time,
        COALESCE(req_u.display_name, req_ce.first_name || ' ' || req_ce.last_name) as requested_by_name, rec_u.display_name as recorded_by_name,
        mgr_u.display_name as manager_review_by_name
      FROM lis_results r
      JOIN lis_specimens s ON r.specimen_id = s.id
      JOIN lis_test_orders o ON s.order_id = o.id
      JOIN lis_participants p ON o.participant_id = p.id
      LEFT JOIN lab_tests t ON r.test_code = t.test_code AND (t.branch_id = r.branch_id OR t.branch_id IS NULL)
      LEFT JOIN lab_test_components c ON t.id = c.lab_test_id AND r.analyte = c.component_name
      LEFT JOIN users req_u ON req_u.id = o.doctor_id
      LEFT JOIN employees req_ce ON req_ce.id = o.consultant_id
      LEFT JOIN users rec_u ON rec_u.id = r.recorded_by
      LEFT JOIN users mgr_u ON mgr_u.id = r.manager_review_by
      WHERE r.status != 'pending_manager_review'
      ${branchFilter.sql}
    `;
    const params = [...branchFilter.params];
    if (dateFrom) { sql += ` AND r.updated_at >= ?`; params.push(`${dateFrom} 00:00:00`); }
    if (dateTo) { sql += ` AND r.updated_at <= ?`; params.push(`${dateTo} 23:59:59`); }
    sql += ` ORDER BY r.updated_at DESC LIMIT 500`;
    const [results] = await db.query(sql, { replacements: params });
    res.json(results);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

router.post('/results/:id/review', authorize('lis.results.review'), async (req, res) => {
  const { sequelize: db } = req.models;
  const { id } = req.params;
  const { action, manager_notes, manager_id } = req.body;
  
  const t = await db.transaction();
  try {
    await db.query(
      `UPDATE lis_results
       SET status = ?, manager_notes = ?, manager_review_by = ?, manager_review_at = NOW()
       WHERE id = ?`,
      { replacements: [action, manager_notes || null, manager_id || null, id], transaction: t }
    );

    // Also update the parent specimen status — kept in the same transaction as the result
    // update above so a failure here can't leave the result marked reviewed while the
    // specimen it belongs to is left on a stale status (e.g. still pending_manager_review).
    const [[result]] = await db.query(`SELECT specimen_id FROM lis_results WHERE id = ?`, { replacements: [id], transaction: t });
    if (result && result.specimen_id) {
      await db.query(`UPDATE lis_specimens SET status = ? WHERE id = ?`, { replacements: [action, result.specimen_id], transaction: t });
    }

    await t.commit();
    res.json({ success: true });
  } catch (error) {
    if (!t.finished) await t.rollback().catch(() => {});
    res.status(500).json({ success: false, error: 'Database error' });
  }
});


/**
 * Lab workload for the dashboard.
 *
 * A lab user's dashboard was showing takings and receivables, which they can
 * neither act on nor are accountable for. What matters on a lab shift is the
 * queue: what is waiting to be collected, what is on the analyser, what is
 * waiting to be approved, and what has been finished today.
 *
 * Specimens move pending_collection -> routed -> analyzed -> approved, so
 * "outstanding" is everything short of approved and "completed" is approved.
 * Counting analyzed as done would flatter the numbers: a result nobody has
 * verified is not a result the clinician can use yet.
 */
router.get('/lab-dashboard', authorize('lis.dashboard.read'), async (req, res) => {
  try {
    const db = req.models?.sequelize || sequelize;
    const today = new Date().toISOString().split('T')[0];
    const branchFilter = getBranchConditionSQL(req, 's');
    const branchNamed = getBranchConditionNamed(req, '');

    const [statusRows] = await db.query(
      `SELECT status, COUNT(*)::int AS n FROM lis_specimens s WHERE 1=1 ${branchFilter.sql} GROUP BY status`,
      { replacements: branchFilter.params }
    );
    const byStatus = Object.fromEntries(statusRows.map(r => [r.status, r.n]));

    const awaitingCollection = byStatus.pending_collection || 0;
    const inProgress = (byStatus.routed || 0) + (byStatus.received || 0);
    const awaitingApproval = byStatus.analyzed || 0;
    const completed = byStatus.approved || 0;
    const outstanding = awaitingCollection + inProgress + awaitingApproval;

    const [[todayRow]] = await db.query(
      `SELECT COUNT(*)::int AS n FROM lis_specimens
        WHERE status = 'approved' AND DATE(COALESCE(updated_at, created_at)) = :today ${branchNamed.sql}`,
      { replacements: { today, ...branchNamed.replacements } }
    );
    const [[todayNewRow]] = await db.query(
      `SELECT COUNT(*)::int AS n FROM lis_specimens WHERE DATE(created_at) = :today ${branchNamed.sql}`,
      { replacements: { today, ...branchNamed.replacements } }
    );

    // The queue itself — newest first, with the patient the sample belongs to.
    const [queue] = await db.query(`
      SELECT s.id, s.test_name AS "testName", s.test_code AS "testCode",
             s.department, s.status, s.barcode,
             s.collection_time AS "collectedAt", s.created_at AS "requestedAt",
             COALESCE(NULLIF(TRIM(lp.first_name || ' ' || lp.last_name), ''), 'Unknown patient') AS "patientName",
             lp.participant_number AS "patientNumber"
        FROM lis_specimens s
        LEFT JOIN lis_test_orders o ON o.id = s.order_id
        LEFT JOIN lis_participants lp ON lp.id = o.participant_id
       WHERE 1=1 ${branchFilter.sql}
       ORDER BY s.created_at DESC
       LIMIT 50
    `, { replacements: branchFilter.params });

    res.json({
      totals: {
        awaitingCollection,
        inProgress,
        awaitingApproval,
        completed,
        outstanding,
        completedToday: todayRow?.n || 0,
        requestedToday: todayNewRow?.n || 0,
        total: outstanding + completed,
      },
      byStatus,
      queue: queue.map(r => ({
        id: r.id,
        testName: r.testName || r.testCode || 'Unknown test',
        department: r.department || '—',
        status: r.status,
        barcode: r.barcode,
        patientName: r.patientName,
        patientNumber: r.patientNumber,
        requestedAt: r.requestedAt,
        collectedAt: r.collectedAt,
      })),
    });
  } catch (error) {
    console.error('Error building lab dashboard:', error);
    res.status(500).json({ error: 'Failed to build lab dashboard' });
  }
});

module.exports = router;
