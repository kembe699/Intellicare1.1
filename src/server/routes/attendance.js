/**
 * HR-side geofenced attendance: sites + QR codes (Sections 1-2), shift
 * schedules (Section 4), and the Today board / reports / manual
 * corrections / portal-access list (Section 6). Mounted at /api/attendance,
 * after authenticateToken/branchAccessControl like every other tenant
 * router — see routes/employeePortal.js for the separate, portal-side
 * clock in/out API this pairs with.
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { sequelize } = require('../models');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { generateSiteKey, signStaticToken, signRotatingToken } = require('../utils/attendanceQr');

function branchScope(req, replacements) {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  return ' AND branch_id = :branchId';
}

router.get('/sites', authorize('attendance.view'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId };
    const [rows] = await sequelize.query(
      `SELECT * FROM attendance_sites WHERE clinic_id = :clinicId${branchScope(req, replacements)} ORDER BY name`,
      { replacements }
    );
    res.json(rows.map((r) => ({ ...r, qr_key: undefined })));
  } catch (error) {
    console.error('Error listing attendance sites:', error);
    res.status(500).json({ error: 'Failed to load attendance sites' });
  }
});

router.post('/sites', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { name, latitude, longitude, radius_m, qr_mode } = req.body || {};
    if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: 'Name, latitude, and longitude are required.' });
    }
    const radius = Number(radius_m) || 100;
    if (radius < 30 || radius > 2000) {
      return res.status(400).json({ error: 'Radius must be between 30 and 2000 meters.' });
    }
    const id = uuidv4();
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchId = getCreateBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'A branch is required to create an attendance site.' });

    await sequelize.query(
      `INSERT INTO attendance_sites (id, clinic_id, branch_id, name, latitude, longitude, radius_m, is_active, qr_mode, qr_key, qr_key_created_at, created_by, created_at, updated_at)
       VALUES (:id, :clinicId, :branchId, :name, :latitude, :longitude, :radius, TRUE, :qrMode, :qrKey, NOW(), :createdBy, NOW(), NOW())`,
      {
        replacements: {
          id, clinicId, branchId, name, latitude, longitude, radius,
          qrMode: qr_mode === 'rotating' ? 'rotating' : 'printed',
          qrKey: generateSiteKey(),
          createdBy: req.user.id,
        },
      }
    );
    const [[site]] = await sequelize.query(`SELECT * FROM attendance_sites WHERE id = :id`, { replacements: { id } });
    res.status(201).json(site);
  } catch (error) {
    console.error('Error creating attendance site:', error);
    res.status(500).json({ error: 'Failed to create attendance site' });
  }
});

router.put('/sites/:id', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { name, latitude, longitude, radius_m, qr_mode, is_active } = req.body || {};
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, clinicId };
    const [[existing]] = await sequelize.query(
      `SELECT * FROM attendance_sites WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
      { replacements }
    );
    if (!existing) return res.status(404).json({ error: 'Attendance site not found' });

    if (radius_m !== undefined && (Number(radius_m) < 30 || Number(radius_m) > 2000)) {
      return res.status(400).json({ error: 'Radius must be between 30 and 2000 meters.' });
    }

    await sequelize.query(
      `UPDATE attendance_sites SET
         name = COALESCE(:name, name),
         latitude = COALESCE(:latitude, latitude),
         longitude = COALESCE(:longitude, longitude),
         radius_m = COALESCE(:radius, radius_m),
         qr_mode = COALESCE(:qrMode, qr_mode),
         is_active = COALESCE(:isActive, is_active),
         updated_at = NOW()
       WHERE id = :id`,
      {
        replacements: {
          id: existing.id,
          name: name ?? null,
          latitude: typeof latitude === 'number' ? latitude : null,
          longitude: typeof longitude === 'number' ? longitude : null,
          radius: radius_m !== undefined ? Number(radius_m) : null,
          qrMode: qr_mode === 'rotating' || qr_mode === 'printed' ? qr_mode : null,
          isActive: typeof is_active === 'boolean' ? is_active : null,
        },
      }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM attendance_sites WHERE id = :id`, { replacements: { id: existing.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error updating attendance site:', error);
    res.status(500).json({ error: 'Failed to update attendance site' });
  }
});

// Regenerating the key invalidates every previously-printed poster
// immediately — see utils/attendanceQr.js's verifyToken, which checks the
// scanned key against the site's CURRENT qr_key.
router.post('/sites/:id/regenerate-key', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { id: req.params.id, clinicId };
    const [[existing]] = await sequelize.query(
      `SELECT * FROM attendance_sites WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
      { replacements }
    );
    if (!existing) return res.status(404).json({ error: 'Attendance site not found' });

    const qrKey = generateSiteKey();
    await sequelize.query(
      `UPDATE attendance_sites SET qr_key = :qrKey, qr_key_created_at = NOW(), updated_at = NOW() WHERE id = :id`,
      { replacements: { id: existing.id, qrKey } }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error regenerating attendance site key:', error);
    res.status(500).json({ error: 'Failed to regenerate QR key' });
  }
});

async function loadSiteOr404(req, res) {
  const clinicId = BranchQueryFilter.resolveClinicId(req);
  const replacements = { id: req.params.id, clinicId };
  const [[site]] = await sequelize.query(
    `SELECT * FROM attendance_sites WHERE id = :id AND clinic_id = :clinicId${branchScope(req, replacements)}`,
    { replacements }
  );
  if (!site) { res.status(404).json({ error: 'Attendance site not found' }); return null; }
  return site;
}

// Returns the printed-poster QR as a data URL — encodes
// /staff/clock?token=...&sig=... so scanning with an ordinary camera app
// also works (it just opens that URL), same as the existing payroll-sign
// QR precedent (routes/hr.js's /signing-link endpoint).
router.get('/sites/:id/qr', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const site = await loadSiteOr404(req, res);
    if (!site) return;
    if (site.qr_mode !== 'printed') {
      return res.status(409).json({ error: 'This site uses a rotating display code, not a printed QR. See /sites/:id/rotating-token.' });
    }
    const { token, sig } = signStaticToken(site);
    const origin = typeof req.query.origin === 'string' && /^https?:\/\//.test(req.query.origin)
      ? req.query.origin.replace(/\/$/, '')
      : `${req.protocol}://${req.get('host')}`;
    const url = `${origin}/staff/clock?token=${encodeURIComponent(token)}&sig=${encodeURIComponent(sig)}`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
    res.json({ site_name: site.name, url, qr_data_url: qrDataUrl });
  } catch (error) {
    console.error('Error generating attendance site QR:', error);
    if (String(error.message || '').includes('ATTENDANCE_QR_SECRET')) {
      return res.status(503).json({ error: 'Attendance QR codes are not configured on this server yet — ATTENDANCE_QR_SECRET is not set. Ask your administrator to add it to the backend environment and restart the server.' });
    }
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Polled every ~30s by the HR-only full-screen display page
// (/attendance/display/:site_id, frontend) to refresh the rotating code.
router.get('/sites/:id/rotating-token', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const site = await loadSiteOr404(req, res);
    if (!site) return;
    if (site.qr_mode !== 'rotating') {
      return res.status(409).json({ error: 'This site uses a printed QR code, not a rotating display.' });
    }
    const { token, sig, expiresInMs } = signRotatingToken(site);
    const origin = typeof req.query.origin === 'string' && /^https?:\/\//.test(req.query.origin)
      ? req.query.origin.replace(/\/$/, '')
      : `${req.protocol}://${req.get('host')}`;
    const url = `${origin}/staff/clock?token=${encodeURIComponent(token)}&sig=${encodeURIComponent(sig)}`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2 });
    res.json({ site_name: site.name, url, qr_data_url: qrDataUrl, expiresInMs });
  } catch (error) {
    console.error('Error generating rotating attendance token:', error);
    if (String(error.message || '').includes('ATTENDANCE_QR_SECRET')) {
      return res.status(503).json({ error: 'Attendance QR codes are not configured on this server yet — ATTENDANCE_QR_SECRET is not set. Ask your administrator to add it to the backend environment and restart the server.' });
    }
    res.status(500).json({ error: 'Failed to generate rotating QR code' });
  }
});

// ─── Section 4: shifts ("keep it simple — no complex rostering") ───────

router.get('/shifts', authorize('attendance.view'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId };
    const [rows] = await sequelize.query(
      `SELECT * FROM shifts WHERE clinic_id = :clinicId${branchScope(req, replacements)} ORDER BY name`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing shifts:', error);
    res.status(500).json({ error: 'Failed to load shifts' });
  }
});

router.post('/shifts', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { name, start_time, end_time, grace_minutes, working_days } = req.body || {};
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ error: 'Name, start time, and end time are required.' });
    }
    const id = uuidv4();
    await sequelize.query(
      `INSERT INTO shifts (id, clinic_id, branch_id, name, start_time, end_time, grace_minutes, working_days, is_active, created_at, updated_at)
       VALUES (:id, :clinicId, :branchId, :name, :startTime, :endTime, :graceMinutes, :workingDays, TRUE, NOW(), NOW())`,
      {
        replacements: {
          id,
          clinicId: BranchQueryFilter.resolveClinicId(req),
          branchId: getCreateBranchId(req),
          name, startTime: start_time, endTime: end_time,
          graceMinutes: Number(grace_minutes) || 10,
          workingDays: working_days || '1,2,3,4,5',
        },
      }
    );
    const [[shift]] = await sequelize.query(`SELECT * FROM shifts WHERE id = :id`, { replacements: { id } });
    res.status(201).json(shift);
  } catch (error) {
    console.error('Error creating shift:', error);
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

router.put('/shifts/:id', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { name, start_time, end_time, grace_minutes, working_days, is_active } = req.body || {};
    await sequelize.query(
      `UPDATE shifts SET
         name = COALESCE(:name, name), start_time = COALESCE(:startTime, start_time),
         end_time = COALESCE(:endTime, end_time), grace_minutes = COALESCE(:graceMinutes, grace_minutes),
         working_days = COALESCE(:workingDays, working_days), is_active = COALESCE(:isActive, is_active),
         updated_at = NOW()
       WHERE id = :id AND clinic_id = :clinicId`,
      {
        replacements: {
          id: req.params.id, clinicId: BranchQueryFilter.resolveClinicId(req),
          name: name ?? null, startTime: start_time ?? null, endTime: end_time ?? null,
          graceMinutes: grace_minutes !== undefined ? Number(grace_minutes) : null,
          workingDays: working_days ?? null,
          isActive: typeof is_active === 'boolean' ? is_active : null,
        },
      }
    );
    const [[shift]] = await sequelize.query(`SELECT * FROM shifts WHERE id = :id`, { replacements: { id: req.params.id } });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    res.json(shift);
  } catch (error) {
    console.error('Error updating shift:', error);
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

// One current shift per employee, no history — assigning replaces any
// existing assignment outright.
router.post('/shifts/:id/assign', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { employee_id } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: 'employee_id is required.' });
    const [[shift]] = await sequelize.query(
      `SELECT id FROM shifts WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId: BranchQueryFilter.resolveClinicId(req) } }
    );
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    await sequelize.query(
      `INSERT INTO employee_shift_assignments (id, clinic_id, employee_id, shift_id, created_at, updated_at)
       VALUES (:id, :clinicId, :employeeId, :shiftId, NOW(), NOW())
       ON CONFLICT (employee_id) DO UPDATE SET shift_id = :shiftId, updated_at = NOW()`,
      { replacements: { id: uuidv4(), clinicId: BranchQueryFilter.resolveClinicId(req), employeeId: employee_id, shiftId: req.params.id } }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error assigning shift:', error);
    res.status(500).json({ error: 'Failed to assign shift' });
  }
});

// Department-level default — applied by reporting/late-calc only through
// employee_shift_assignments (an explicit per-employee assignment always
// wins); this table is just where a department's default shift is set, a
// UI convenience for bulk-assigning new hires, not read directly by the
// attendance_days view.
router.put('/shift-defaults/:department', authorize('attendance.manage_sites'), async (req, res) => {
  try {
    const { shift_id } = req.body || {};
    if (!shift_id) return res.status(400).json({ error: 'shift_id is required.' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchId = getCreateBranchId(req);
    await sequelize.query(
      `INSERT INTO department_shift_defaults (id, clinic_id, branch_id, department, shift_id, created_at, updated_at)
       VALUES (:id, :clinicId, :branchId, :department, :shiftId, NOW(), NOW())
       ON CONFLICT (clinic_id, COALESCE(branch_id, -1), department) DO UPDATE SET shift_id = :shiftId, updated_at = NOW()`,
      { replacements: { id: uuidv4(), clinicId, branchId, department: req.params.department, shiftId: shift_id } }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error setting department default shift:', error);
    res.status(500).json({ error: 'Failed to set department default shift' });
  }
});

// ─── Section 6: Today board, reports, raw log, corrections, portal access ───

router.get('/today-board', authorize('attendance.view'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId };
    const branchClause = branchScope(req, replacements);
    const departmentClause = req.query.department ? ' AND e.department = :department' : '';
    if (req.query.department) replacements.department = req.query.department;

    const [rows] = await sequelize.query(
      `SELECT
         e.id AS employee_id, e.employee_number, e.first_name, e.last_name, e.department,
         ad.first_in, ad.last_out, ad.late_minutes, ad.missing_clock_out,
         lr.id AS leave_request_id
       FROM employees e
       LEFT JOIN attendance_days ad ON ad.employee_id = e.id AND ad.shift_date = CURRENT_DATE
       LEFT JOIN leave_requests lr ON lr.employee_id = e.id AND lr.status = 'approved'
         AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
       WHERE e.clinic_id = :clinicId AND e.is_active = TRUE AND e.employment_status = 'active'${branchClause.replace('branch_id', 'e.branch_id')}${departmentClause}
       ORDER BY e.first_name, e.last_name`,
      { replacements }
    );

    const board = rows.map((r) => {
      let status;
      if (r.leave_request_id) status = 'on_leave';
      else if (r.first_in && !r.last_out) status = 'present';
      else if (r.first_in && r.last_out) status = 'clocked_out';
      else status = 'absent';
      return {
        employee_id: r.employee_id,
        employee_number: r.employee_number,
        name: `${r.first_name} ${r.last_name}`,
        department: r.department,
        status,
        first_in: r.first_in,
        last_out: r.last_out,
        late_minutes: r.late_minutes ? Math.round(Number(r.late_minutes)) : 0,
        missing_clock_out: !!r.missing_clock_out,
      };
    });
    res.json({
      board,
      counts: {
        present: board.filter((b) => b.status === 'present').length,
        clocked_out: board.filter((b) => b.status === 'clocked_out').length,
        on_leave: board.filter((b) => b.status === 'on_leave').length,
        absent: board.filter((b) => b.status === 'absent').length,
        late: board.filter((b) => b.late_minutes > 0).length,
        missing_clock_out: board.filter((b) => b.missing_clock_out).length,
      },
    });
  } catch (error) {
    console.error('Error loading today board:', error);
    res.status(500).json({ error: 'Failed to load today board' });
  }
});

// Per-employee summary over a date range — days present, hours, late
// count/minutes, early-leave count, absences (scheduled working days this
// employee's shift covers, minus days present minus approved-leave days;
// 0 when the employee has no shift assignment, since there's then no
// schedule to be absent from). Overtime is not computed — no threshold is
// defined anywhere in the spec or the existing payroll module to compute
// it against; flagged as a known limitation, not silently guessed at.
router.get('/reports', authorize('attendance.view'), async (req, res) => {
  try {
    const { from, to, department, employee_id, format } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates are required.' });
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId, from, to };
    const branchClause = branchScope(req, replacements).replace('branch_id', 'e.branch_id');
    const departmentClause = department ? ' AND e.department = :department' : '';
    if (department) replacements.department = department;
    const employeeClause = employee_id ? ' AND e.id = :employeeId' : '';
    if (employee_id) replacements.employeeId = employee_id;

    const [rows] = await sequelize.query(
      `SELECT
         e.id AS employee_id, e.employee_number, e.first_name, e.last_name, e.department,
         COUNT(ad.shift_date) AS days_present,
         COALESCE(SUM(ad.hours_worked), 0) AS total_hours,
         COUNT(*) FILTER (WHERE ad.late_minutes > 0) AS late_count,
         COALESCE(SUM(ad.late_minutes), 0) AS late_minutes_total,
         COUNT(*) FILTER (WHERE ad.early_leave_minutes > 0) AS early_leave_count,
         (SELECT COALESCE(SUM(lr.days), 0) FROM leave_requests lr WHERE lr.employee_id = e.id AND lr.status = 'approved'
           AND lr.start_date <= :to AND lr.end_date >= :from) AS leave_days
       FROM employees e
       LEFT JOIN attendance_days ad ON ad.employee_id = e.id AND ad.shift_date BETWEEN :from AND :to
       WHERE e.clinic_id = :clinicId AND e.is_active = TRUE${branchClause}${departmentClause}${employeeClause}
       GROUP BY e.id, e.employee_number, e.first_name, e.last_name, e.department
       ORDER BY e.first_name, e.last_name`,
      { replacements }
    );

    const report = rows.map((r) => ({
      employee_id: r.employee_id,
      employee_number: r.employee_number,
      name: `${r.first_name} ${r.last_name}`,
      department: r.department,
      days_present: Number(r.days_present),
      total_hours: Math.round(Number(r.total_hours) * 100) / 100,
      late_count: Number(r.late_count),
      late_minutes_total: Math.round(Number(r.late_minutes_total)),
      early_leave_count: Number(r.early_leave_count),
      leave_days: Number(r.leave_days),
    }));

    if (format === 'csv') {
      const header = 'Employee Number,Name,Department,Days Present,Total Hours,Late Count,Late Minutes,Early Leave Count,Leave Days';
      const lines = report.map((r) => [r.employee_number, r.name, r.department || '', r.days_present, r.total_hours, r.late_count, r.late_minutes_total, r.early_leave_count, r.leave_days].join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${from}-to-${to}.csv"`);
      return res.send([header, ...lines].join('\n'));
    }
    res.json(report);
  } catch (error) {
    console.error('Error generating attendance report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Raw log, with map-pin lat/lon, for HR review of both accepted and
// rejected attempts.
router.get('/records', authorize('attendance.view'), async (req, res) => {
  try {
    const { employee_id, site_id, status, from, to } = req.query;
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId };
    const branchClause = branchScope(req, replacements);
    const conditions = [`ar.clinic_id = :clinicId`];
    if (employee_id) { conditions.push('ar.employee_id = :employeeId'); replacements.employeeId = employee_id; }
    if (site_id) { conditions.push('ar.site_id = :siteId'); replacements.siteId = site_id; }
    if (status) { conditions.push('ar.status = :status'); replacements.status = status; }
    if (from) { conditions.push('ar.occurred_at >= :from'); replacements.from = from; }
    if (to) { conditions.push('ar.occurred_at <= :to'); replacements.to = to; }
    const branchWhere = branchClause ? branchClause.replace('AND branch_id', 'AND ar.branch_id') : '';

    const [rows] = await sequelize.query(
      `SELECT ar.*, e.employee_number, e.first_name, e.last_name, s.name AS site_name
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       JOIN attendance_sites s ON s.id = ar.site_id
       WHERE ${conditions.join(' AND ')}${branchWhere}
       ORDER BY ar.occurred_at DESC LIMIT 500`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error loading attendance records:', error);
    res.status(500).json({ error: 'Failed to load attendance records' });
  }
});

// Manual correction — reason is required and every change is audited
// (who/when/old/new), per spec.
router.put('/records/:id/correct', authorize('attendance.correct'), async (req, res) => {
  try {
    const { type, occurred_at, reason } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'A reason is required to correct an attendance record.' });
    }
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [[existing]] = await sequelize.query(
      `SELECT * FROM attendance_records WHERE id = :id AND clinic_id = :clinicId`,
      { replacements: { id: req.params.id, clinicId } }
    );
    if (!existing) return res.status(404).json({ error: 'Attendance record not found' });

    const newType = type && ['in', 'out'].includes(type) ? type : existing.type;
    const newOccurredAt = occurred_at || existing.occurred_at;

    await sequelize.query(
      `UPDATE attendance_records SET type = :type, occurred_at = :occurredAt, status = 'corrected',
         corrected_by = :correctedBy, correction_reason = :reason WHERE id = :id`,
      { replacements: { id: existing.id, type: newType, occurredAt: newOccurredAt, correctedBy: req.user.id, reason } }
    );
    await sequelize.query(
      `INSERT INTO attendance_record_audit (id, record_id, changed_by, reason, old_values, new_values, created_at)
       VALUES (:id, :recordId, :changedBy, :reason, :oldValues, :newValues, NOW())`,
      {
        replacements: {
          id: uuidv4(), recordId: existing.id, changedBy: req.user.id, reason,
          oldValues: JSON.stringify({ type: existing.type, occurred_at: existing.occurred_at, status: existing.status }),
          newValues: JSON.stringify({ type: newType, occurred_at: newOccurredAt, status: 'corrected' }),
        },
      }
    );
    const [[updated]] = await sequelize.query(`SELECT * FROM attendance_records WHERE id = :id`, { replacements: { id: existing.id } });
    res.json(updated);
  } catch (error) {
    console.error('Error correcting attendance record:', error);
    res.status(500).json({ error: 'Failed to correct attendance record' });
  }
});

// Who has portal access, last login, locked accounts — for HR's "portal
// access list".
router.get('/portal-access', authorize('portal.manage_access'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const replacements = { clinicId };
    const [rows] = await sequelize.query(
      `SELECT id, employee_number, first_name, last_name, department, portal_access_enabled,
              portal_pin_set_at, portal_last_login_at,
              (portal_locked_until IS NOT NULL AND portal_locked_until > NOW()) AS is_locked
       FROM employees WHERE clinic_id = :clinicId${branchScope(req, replacements)} AND is_active = TRUE
       ORDER BY first_name, last_name`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error loading portal access list:', error);
    res.status(500).json({ error: 'Failed to load portal access list' });
  }
});

module.exports = router;
