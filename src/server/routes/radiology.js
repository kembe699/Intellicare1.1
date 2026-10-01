const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');

// Same NULL-inclusive branch rule as services.js's branchWhere() — a radiology
// exam type or request with no branch_id (the seeded catalog, or a request made
// before a branch was assigned) stays visible everywhere rather than vanishing
// for every branch-scoped user.
function branchScope(req, replacements, alias = '') {
  if (req.user?.role === 'admin' && !req.branchContext?.adminScoped) return '';
  const branchId = req.branchContext?.branchId || req.user?.branchId;
  if (!branchId) return '';
  replacements.branchId = branchId;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  return ` AND (${col} = :branchId OR ${col} IS NULL)`;
}

// Radiology exam catalog — plain slice of the generic `services` table
// (category='Radiology'), same source the ward's own radiology tab already
// prices imaging from (see PatientDetails.tsx). Gated on radiology.read (not
// inventory/services privileges) so whoever can already see the LIS drug/test
// pickers can see this too.
router.get('/exam-types', authorize('radiology.read'), async (req, res) => {
  try {
    const replacements = {};
    const branchSQL = branchScope(req, replacements);
    const [rows] = await sequelize.query(
      `SELECT id, service_name AS name, price
       FROM services
       WHERE category = 'Radiology' AND is_active = true ${branchSQL}
       ORDER BY service_name`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing radiology exam types:', error);
    res.status(500).json({ error: 'Failed to list exam types' });
  }
});

// Creation rides on lis.clinical.write — the same privilege POST /api/lis/orders
// itself requires — since requesting an exam is part of placing that order, not
// a radiology-department action. radiology.write is reserved for what the
// radiology side actually does: confirm + report.
router.post('/requests', authorize('lis.clinical.write'), async (req, res) => {
  try {
    const { participant_id, order_id, items, doctor_id, auto_bill: autoBill } = req.body;
    if (!participant_id) return res.status(400).json({ error: 'participant_id is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one exam item is required' });

    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchId = getCreateBranchId(req);
    const requestedByName = req.user?.displayName || req.user?.email || null;
    const now = new Date();
    const prefix = `RAD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const created = [];
    for (const item of items) {
      if (!item?.exam_name) continue;
      const [countResult] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM radiology_requests WHERE request_number LIKE :prefix`,
        { replacements: { prefix: `${prefix}%` } }
      );
      const seq = (parseInt(countResult[0]?.cnt, 10) || 0) + 1;
      const requestNumber = `${prefix}-${String(seq).padStart(4, '0')}`;
      const id = uuidv4();
      await sequelize.query(
        `INSERT INTO radiology_requests (id, clinic_id, branch_id, request_number, participant_id, order_id,
          service_id, exam_name, doctor_id, requested_by_name, request_date, clinical_indication, urgent, status)
         VALUES (:id, :clinicId, :branchId, :requestNumber, :participantId, :orderId,
          :serviceId, :examName, :doctorId, :requestedByName, :requestDate, :clinicalIndication, :urgent, 'pending')`,
        { replacements: {
          id, clinicId, branchId, requestNumber, participantId: participant_id, orderId: order_id || null,
          serviceId: item.service_id || null, examName: item.exam_name, doctorId: doctor_id || null,
          requestedByName, requestDate: now, clinicalIndication: item.clinical_indication || null,
          urgent: !!item.urgent,
        } }
      );
      created.push({ id, request_number: requestNumber, exam_name: item.exam_name });
    }

    if (created.length === 0) return res.status(400).json({ error: 'No valid exam items to request' });

    // Opt-in, same convention as /api/lis/orders' auto_bill: radiology
    // ordered from LISTestOrders.tsx is explicitly NOT billed today ("radiology
    // billing isn't wired up yet" — see that file's own comment near
    // selectedRadiologyIds), a real, separate, pre-existing gap this isn't
    // fixing. Only a caller that passes auto_bill: true (the theatre page)
    // gets billed here, so every existing caller's behavior is unchanged.
    if (autoBill) {
      const billableItems = items.filter((it) => parseFloat(it.price) > 0);
      if (billableItems.length > 0) {
        try {
          const { addLineItemsToBill } = require('../utils/billingResolver');
          const [[participant]] = await sequelize.query(`SELECT first_name, last_name FROM lis_participants WHERE id = :pid`, { replacements: { pid: participant_id } });
          await addLineItemsToBill({
            patientId: participant_id,
            patientName: participant ? `${participant.first_name} ${participant.last_name}`.trim() : 'Patient',
            clinicId: req.body.clinic_id || BranchQueryFilter.resolveClinicId(req),
            branchId: req.body.branch_id || getCreateBranchId(req),
            lineItems: billableItems.map((it) => ({
              serviceName: it.exam_name, quantity: 1, unitPrice: parseFloat(it.price), totalPrice: parseFloat(it.price),
              revenueCategory: 'radiology',
            })),
            createdBy: req.user?.displayName || req.user?.id || 'system',
          });
        } catch (billErr) {
          console.error(`Radiology request for participant ${participant_id}: exam(s) requested, but billing failed —`, billErr.message);
        }
      }
    }

    res.status(201).json({ requests: created });
  } catch (error) {
    console.error('Error creating radiology request:', error);
    res.status(500).json({ error: 'Failed to create radiology request' });
  }
});

router.get('/requests', authorize('radiology.read'), async (req, res) => {
  try {
    const { status, order_id, participant_id: participantId } = req.query;
    const replacements = {};
    const branchSQL = branchScope(req, replacements, 'rr');
    let sql = `
      SELECT rr.id, rr.request_number, rr.exam_name, rr.status, rr.urgent, rr.request_date,
        rr.clinical_indication, rr.doctor_id, rr.requested_by_name, rr.report_html,
        rr.confirmed_by_name, rr.confirmed_at, rr.reported_by_name, rr.reported_at,
        p.participant_number, p.first_name, p.last_name,
        COALESCE(u.display_name, rr.requested_by_name) AS doctor_name
      FROM radiology_requests rr
      JOIN lis_participants p ON p.id = rr.participant_id
      LEFT JOIN users u ON u.id = rr.doctor_id
      WHERE 1=1 ${branchSQL}
    `;
    if (status) { sql += ' AND rr.status = :status'; replacements.status = status; }
    // Visit Summary looks up a visit's radiology by the LIS order it was
    // requested under — matches the same order_id every request in that
    // visit shares (see /visits' grouping rule).
    if (order_id) { sql += ' AND rr.order_id = :orderId'; replacements.orderId = order_id; }
    // A patient's full radiology history, including order-less standalone
    // requests an order_id-only lookup would miss — added for the theatre
    // operation page's "Radiology" panel.
    if (participantId) { sql += ' AND rr.participant_id = :participantId'; replacements.participantId = participantId; }
    sql += ' ORDER BY rr.request_date DESC';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing radiology requests:', error);
    res.status(500).json({ error: 'Failed to list radiology requests' });
  }
});

// One row per visit (order_id when the requests came from an LIS order — the
// normal case — otherwise each order-less request stands alone as its own
// single-item "visit", via COALESCE(order_id, id) as the group key, so two
// unrelated order-less requests for the same patient are never merged just
// because they share no order). Backs the Radiology queue table: a doctor who
// ordered 3 exams in one visit sees one row with request_count=3, not 3 rows.
router.get('/visits', authorize('radiology.read'), async (req, res) => {
  try {
    const replacements = {};
    const branchSQL = branchScope(req, replacements, 'rr');
    const [rows] = await sequelize.query(
      `SELECT
         MIN(rr.id) AS id,
         rr.participant_id,
         MIN(rr.request_date) AS request_date,
         COUNT(*) AS request_count,
         COUNT(*) FILTER (WHERE rr.status = 'pending') AS pending_count,
         COUNT(*) FILTER (WHERE rr.status = 'in_progress') AS in_progress_count,
         COUNT(*) FILTER (WHERE rr.status = 'completed') AS completed_count,
         BOOL_OR(rr.urgent) AS urgent,
         p.participant_number, p.first_name, p.last_name,
         MAX(COALESCE(u.display_name, rr.requested_by_name)) AS doctor_name
       FROM radiology_requests rr
       JOIN lis_participants p ON p.id = rr.participant_id
       LEFT JOIN users u ON u.id = rr.doctor_id
       WHERE 1=1 ${branchSQL}
       GROUP BY rr.participant_id, COALESCE(rr.order_id, rr.id), p.participant_number, p.first_name, p.last_name
       ORDER BY MIN(rr.request_date) DESC`,
      { replacements }
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing radiology visits:', error);
    res.status(500).json({ error: 'Failed to list radiology visits' });
  }
});

// Given any one request's id, resolves and returns every request from the
// same visit (see /visits above for the grouping rule) — what the detail page
// actually renders, so a doctor who ordered several exams together can
// confirm/report/print each one without leaving the page.
router.get('/requests/:id/visit', authorize('radiology.read'), async (req, res) => {
  try {
    const keyReplacements = { id: req.params.id };
    const keyBranchSQL = branchScope(req, keyReplacements);
    const [[anchor]] = await sequelize.query(
      `SELECT participant_id, COALESCE(order_id, id) AS visit_key FROM radiology_requests WHERE id = :id ${keyBranchSQL}`,
      { replacements: keyReplacements }
    );
    if (!anchor) return res.status(404).json({ error: 'Radiology request not found' });

    const replacements = { participantId: anchor.participant_id, visitKey: anchor.visit_key };
    const branchSQL = branchScope(req, replacements, 'rr');
    const [rows] = await sequelize.query(
      `SELECT rr.*, p.participant_number, p.first_name, p.last_name, p.gender, p.date_of_birth,
         COALESCE(u.display_name, rr.requested_by_name) AS doctor_name
       FROM radiology_requests rr
       JOIN lis_participants p ON p.id = rr.participant_id
       LEFT JOIN users u ON u.id = rr.doctor_id
       WHERE rr.participant_id = :participantId AND COALESCE(rr.order_id, rr.id) = :visitKey ${branchSQL}
       ORDER BY rr.request_date ASC`,
      { replacements }
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Radiology request not found' });
    res.json({ requests: rows });
  } catch (error) {
    console.error('Error fetching radiology visit:', error);
    res.status(500).json({ error: 'Failed to fetch radiology visit' });
  }
});

router.get('/requests/:id', authorize('radiology.read'), async (req, res) => {
  try {
    const replacements = { id: req.params.id };
    const branchSQL = branchScope(req, replacements, 'rr');
    const [rows] = await sequelize.query(
      `SELECT rr.*, p.participant_number, p.first_name, p.last_name, p.gender, p.date_of_birth,
        COALESCE(u.display_name, rr.requested_by_name) AS doctor_name
       FROM radiology_requests rr
       JOIN lis_participants p ON p.id = rr.participant_id
       LEFT JOIN users u ON u.id = rr.doctor_id
       WHERE rr.id = :id ${branchSQL}`,
      { replacements }
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Radiology request not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching radiology request:', error);
    res.status(500).json({ error: 'Failed to fetch radiology request' });
  }
});

// "Check/confirm" — acknowledges the tech has picked up the exam. Only valid
// from pending, so an already-reported request can't be bounced back.
router.put('/requests/:id/confirm', authorize('radiology.write'), async (req, res) => {
  try {
    const replacements = { id: req.params.id, confirmedBy: req.user?.id || null, confirmedByName: req.user?.displayName || req.user?.email || null };
    const branchSQL = branchScope(req, replacements);
    const [, meta] = await sequelize.query(
      `UPDATE radiology_requests
       SET status = 'in_progress', confirmed_by = :confirmedBy, confirmed_by_name = :confirmedByName, confirmed_at = NOW(), updated_at = NOW()
       WHERE id = :id AND status = 'pending' ${branchSQL}`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Request not found or already confirmed' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error confirming radiology request:', error);
    res.status(500).json({ error: 'Failed to confirm radiology request' });
  }
});

// Report body — a draft save (complete:false) keeps status at in_progress so it
// stays editable; complete:true files it and stamps who/when, same shape as
// pharmacy dispensing's own audit stamps.
router.put('/requests/:id/report', authorize('radiology.write'), async (req, res) => {
  try {
    const { report_html, complete } = req.body;
    const replacements = {
      id: req.params.id, reportHtml: report_html || null,
      reportedBy: req.user?.id || null, reportedByName: req.user?.displayName || req.user?.email || null,
    };
    const branchSQL = branchScope(req, replacements);
    const statusClause = complete
      ? `status = 'completed', reported_by = :reportedBy, reported_by_name = :reportedByName, reported_at = NOW(),`
      : '';
    const [, meta] = await sequelize.query(
      `UPDATE radiology_requests
       SET report_html = :reportHtml, ${statusClause} updated_at = NOW()
       WHERE id = :id AND status IN ('in_progress', 'completed') ${branchSQL}`,
      { replacements }
    );
    if (meta.rowCount === 0) return res.status(409).json({ error: 'Request not found or not yet confirmed' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving radiology report:', error);
    res.status(500).json({ error: 'Failed to save radiology report' });
  }
});

module.exports = router;
