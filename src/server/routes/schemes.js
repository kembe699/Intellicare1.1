const express = require('express');
const { authorize } = require('../middleware/authorize');

// Server-side role gate. These endpoints had none: any authenticated user of
// any role could call them, regardless of what the UI shows. Mirrors the roles
// App.tsx allows on /scheme-management, so the API enforces what the client already assumes.
const SCHEME_WRITE = ['admin', 'finance_manager', 'accountant'];
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');

// ════════════════════════════════════════
// SCHEME CRUD
// ════════════════════════════════════════

// List all schemes
router.get('/', async (req, res) => {
  try {
    const { clinic_id, type, is_active } = req.query;
    const cid = parseInt(clinic_id) || 1;
    let where = 'WHERE ps.clinic_id = :cid';
    const replacements = { cid };
    if (type) { where += ' AND ps.scheme_type = :type'; replacements.type = type; }
    if (is_active !== undefined) { where += ' AND ps.is_active = :active'; replacements.active = is_active === 'true'; }

    const [rows] = await sequelize.query(`
      SELECT ps.*,
        (SELECT COUNT(*) FROM scheme_membership sm WHERE sm.scheme_id = ps.id AND sm.is_active = true) AS member_count
      FROM patient_schemes ps
      ${where}
      ORDER BY ps.is_default DESC, ps.scheme_name ASC
    `, { replacements });
    res.json(rows);
  } catch (error) {
    console.error('Error listing schemes:', error);
    res.status(500).json({ error: 'Failed to list schemes' });
  }
});

// Get active schemes
router.get('/active', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const [rows] = await sequelize.query(`
      SELECT id, scheme_code, scheme_name, scheme_type, is_default, is_insurance,
        default_copay_percentage, pricing_strategy, base_markup_percentage, base_discount_percentage
      FROM patient_schemes
      WHERE clinic_id = :cid AND is_active = true
      ORDER BY is_default DESC, scheme_name ASC
    `, { replacements: { cid } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list active schemes' });
  }
});

// Get scheme by type
router.get('/by-type/:type', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const [rows] = await sequelize.query(`
      SELECT * FROM patient_schemes WHERE clinic_id = :cid AND scheme_type = :type AND is_active = true
      ORDER BY scheme_name
    `, { replacements: { cid, type: req.params.type } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list schemes by type' });
  }
});

// Get scheme memberships for a patient
router.get('/membership/patient/:patientId', async (req, res) => {
  try {
    const pid = req.params.patientId;
    const [rows] = await sequelize.query(`
      SELECT sm.*, ps.scheme_name, ps.scheme_type, ps.pricing_strategy
      FROM scheme_membership sm
      JOIN patient_schemes ps ON sm.scheme_id = ps.id
      WHERE (sm.patient_id = :pid) AND sm.is_active = true AND ps.is_active = true
        AND (sm.effective_to IS NULL OR sm.effective_to >= CURRENT_DATE)
      ORDER BY sm.created_at DESC
    `, { replacements: { pid } });

    if (rows.length === 0) {
      // Also check patient.default_scheme_id
      const [patients] = await sequelize.query(
        'SELECT default_scheme_id FROM patients WHERE id = :pid OR patient_id = :pid LIMIT 1',
        { replacements: { pid } }
      );
      if (patients.length > 0 && patients[0].default_scheme_id) {
        const [schemes] = await sequelize.query(`
          SELECT ps.id AS scheme_id, ps.scheme_name, ps.scheme_type, ps.pricing_strategy, true AS is_active
          FROM patient_schemes ps WHERE ps.id = :sid AND ps.is_active = true
        `, { replacements: { sid: patients[0].default_scheme_id } });
        return res.json(schemes);
      }
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching patient memberships:', error);
    res.status(500).json({ error: 'Failed to fetch patient memberships' });
  }
});

// Get all pricing across all schemes (for CSV template pre-fill)
router.get('/all-pricing', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const itemType = req.query.item_type || 'service';

    let rows;
    if (itemType === 'service') {
      [rows] = await sequelize.query(`
        SELECT ssp.scheme_id, ssp.service_id AS item_id, ssp.scheme_price
        FROM scheme_service_pricing ssp
        WHERE ssp.clinic_id = :cid AND ssp.is_active = true
          AND (ssp.effective_to IS NULL OR ssp.effective_to >= CURRENT_DATE)
      `, { replacements: { cid } });
    } else {
      [rows] = await sequelize.query(`
        SELECT spp.scheme_id, spp.product_id AS item_id, spp.scheme_price
        FROM scheme_product_pricing spp
        WHERE spp.clinic_id = :cid AND spp.is_active = true
          AND (spp.effective_to IS NULL OR spp.effective_to >= CURRENT_DATE)
      `, { replacements: { cid } });
    }
    res.json(rows);
  } catch (error) {
    console.error('Error fetching all pricing:', error);
    res.status(500).json({ error: 'Failed to fetch pricing data' });
  }
});

// Get single scheme
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`SELECT * FROM patient_schemes WHERE id = :id`, { replacements: { id: req.params.id } });
    if (rows.length === 0) return res.status(404).json({ error: 'Scheme not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error getting scheme:', error);
    res.status(500).json({ error: 'Failed to get scheme', details: error.message });
  }
});

// Create scheme
router.post('/', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const id = uuidv4();
    const {
      clinic_id, scheme_code, scheme_name, scheme_description, scheme_type,
      is_default, requires_verification, requires_approval,
      pricing_strategy, base_markup_percentage, base_discount_percentage,
      is_insurance, insurance_provider_name, insurance_provider_code,
      requires_authorization, has_copay, default_copay_percentage, copay_cap_per_visit,
      payment_terms, is_credit_allowed, credit_limit, requires_deposit, deposit_amount,
      revenue_account_id, discount_account_id,
      approval_required_above, allows_negotiation,
      contact_person, contact_phone, contact_email, website, notes,
      currency
    } = req.body;
    const cid = parseInt(clinic_id) || 1;

    // If setting as default, unset other defaults
    if (is_default) {
      await sequelize.query('UPDATE patient_schemes SET is_default = false WHERE clinic_id = :cid', { replacements: { cid }, transaction: t });
    }

    await sequelize.query(`
      INSERT INTO patient_schemes (id, clinic_id, scheme_code, scheme_name, scheme_description, scheme_type,
        is_default, is_active, requires_verification, requires_approval,
        pricing_strategy, base_markup_percentage, base_discount_percentage,
        is_insurance, insurance_provider_name, insurance_provider_code,
        requires_authorization, has_copay, default_copay_percentage, copay_cap_per_visit,
        payment_terms, is_credit_allowed, credit_limit, requires_deposit, deposit_amount,
        revenue_account_id, discount_account_id,
        approval_required_above, allows_negotiation,
        contact_person, contact_phone, contact_email, website, notes, currency, created_by)
      VALUES (:id, :cid, :code, :name, :desc, :type,
        :isDefault, true, :reqVerify, :reqApproval,
        :strategy, :markup, :discount,
        :isIns, :insName, :insCode,
        :reqAuth, :hasCopay, :copayPct, :copayCap,
        :payTerms, :creditAllowed, :creditLimit, :reqDeposit, :depositAmt,
        :revAcct, :discAcct,
        :approvalAbove, :allowsNeg,
        :contactPerson, :contactPhone, :contactEmail, :website, :notes, :currency, :createdBy)
    `, {
      replacements: {
        id, cid, code: scheme_code, name: scheme_name, desc: scheme_description || null, type: scheme_type || 'individual',
        isDefault: is_default || false, reqVerify: requires_verification || false, reqApproval: requires_approval || false,
        strategy: pricing_strategy || 'fixed', markup: base_markup_percentage || 0, discount: base_discount_percentage || 0,
        isIns: is_insurance || false, insName: insurance_provider_name || null, insCode: insurance_provider_code || null,
        reqAuth: requires_authorization || false, hasCopay: has_copay !== false, copayPct: default_copay_percentage || 0, copayCap: copay_cap_per_visit || null,
        payTerms: payment_terms || 'immediate', creditAllowed: is_credit_allowed || false, creditLimit: credit_limit || 0,
        reqDeposit: requires_deposit || false, depositAmt: deposit_amount || null,
        revAcct: revenue_account_id || null, discAcct: discount_account_id || null,
        approvalAbove: approval_required_above || null, allowsNeg: allows_negotiation || false,
        contactPerson: contact_person || null, contactPhone: contact_phone || null,
        contactEmail: contact_email || null, website: website || null, notes: notes || null,
        currency: currency || 'SSP', createdBy: req.user?.id || null
      },
      transaction: t
    });

    // Audit trail
    await sequelize.query(`
      INSERT INTO scheme_changes_history (id, clinic_id, scheme_id, change_type, field_changed, new_value, changed_by, reason)
      VALUES (:id, :cid, :sid, 'created', 'all', :val, :by, 'Scheme created')
    `, { replacements: { id: uuidv4(), cid, sid: id, val: scheme_name, by: req.user?.id || null }, transaction: t });

    await t.commit();
    res.status(201).json({ id, scheme_code, scheme_name, message: 'Scheme created successfully' });
  } catch (error) {
    await t.rollback();
    console.error('Error creating scheme:', error);
    res.status(500).json({ error: 'Failed to create scheme' });
  }
});

// Update scheme
router.put('/:id', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const schemeId = req.params.id;
    const [existing] = await sequelize.query('SELECT * FROM patient_schemes WHERE id = :id', { replacements: { id: schemeId }, transaction: t });
    if (existing.length === 0) { await t.rollback(); return res.status(404).json({ error: 'Scheme not found' }); }

    const fields = [
      'scheme_name', 'scheme_description', 'scheme_type', 'is_default', 'is_active',
      'requires_verification', 'requires_approval', 'pricing_strategy',
      'base_markup_percentage', 'base_discount_percentage',
      'is_insurance', 'insurance_provider_name', 'insurance_provider_code',
      'requires_authorization', 'has_copay', 'default_copay_percentage', 'copay_cap_per_visit',
      'payment_terms', 'is_credit_allowed', 'credit_limit', 'requires_deposit', 'deposit_amount',
      'revenue_account_id', 'discount_account_id',
      'approval_required_above', 'allows_negotiation',
      'contact_person', 'contact_phone', 'contact_email', 'website', 'notes', 'currency'
    ];

    // Decimal fields that must be null instead of empty string
    const decimalFields = new Set([
      'base_markup_percentage', 'base_discount_percentage',
      'default_copay_percentage', 'copay_cap_per_visit',
      'credit_limit', 'deposit_amount', 'approval_required_above'
    ]);

    const sets = [];
    const replacements = { id: schemeId };
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = :${f}`);
        let val = req.body[f];
        // Convert empty strings to null for decimal columns
        if (decimalFields.has(f) && (val === '' || val === null)) {
          val = null;
        }
        replacements[f] = val;

        // Record change in history
        if (existing[0][f] !== req.body[f]) {
          await sequelize.query(`
            INSERT INTO scheme_changes_history (id, clinic_id, scheme_id, change_type, field_changed, old_value, new_value, changed_by)
            VALUES (:hid, :cid, :sid, 'updated', :field, :oldVal, :newVal, :by)
          `, {
            replacements: {
              hid: uuidv4(), cid: existing[0].clinic_id, sid: schemeId,
              field: f, oldVal: String(existing[0][f] ?? ''), newVal: String(req.body[f] ?? ''),
              by: req.user?.id || null
            }, transaction: t
          });
        }
      }
    }

    if (sets.length > 0) {
      // If setting as default, unset others
      if (req.body.is_default) {
        await sequelize.query('UPDATE patient_schemes SET is_default = false WHERE clinic_id = :cid AND id != :id',
          { replacements: { cid: existing[0].clinic_id, id: schemeId }, transaction: t });
      }
      await sequelize.query(`UPDATE patient_schemes SET ${sets.join(', ')} WHERE id = :id`, { replacements, transaction: t });
    }

    await t.commit();
    res.json({ message: 'Scheme updated successfully' });
  } catch (error) {
    await t.rollback();
    console.error('Error updating scheme:', error);
    res.status(500).json({ error: 'Failed to update scheme' });
  }
});

// Deactivate scheme
router.delete('/:id', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query('UPDATE patient_schemes SET is_active = false WHERE id = :id', { replacements: { id: req.params.id } });
    res.json({ message: 'Scheme deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate scheme' });
  }
});

// Change history
router.get('/:id/change-history', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT sch.*, u.display_name AS changed_by_name
      FROM scheme_changes_history sch
      LEFT JOIN users u ON u.id = sch.changed_by
      WHERE sch.scheme_id = :id
      ORDER BY sch.change_date DESC LIMIT 100
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get change history' });
  }
});

// ════════════════════════════════════════
// SCHEME MEMBERSHIP
// ════════════════════════════════════════

// Add patient to scheme
router.post('/:id/members', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const schemeId = req.params.id;
    const { clinic_id, patient_id, member_number, effective_from, effective_to, relationship_to_member, notes } = req.body;
    const cid = parseInt(clinic_id) || 1;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO scheme_membership (id, clinic_id, scheme_id, patient_id, member_number,
        effective_from, effective_to, is_active, relationship_to_member, notes)
      VALUES (:id, :cid, :sid, :pid, :mnum, :from, :to, true, :rel, :notes)
      ON CONFLICT (patient_id, scheme_id) DO UPDATE SET member_number = EXCLUDED.member_number, effective_from = EXCLUDED.effective_from,
        effective_to = EXCLUDED.effective_to, is_active = true, relationship_to_member = EXCLUDED.relationship_to_member, notes = EXCLUDED.notes
    `, {
      replacements: {
        id, cid, sid: schemeId, pid: patient_id, mnum: member_number || null,
        from: effective_from || new Date().toISOString().split('T')[0],
        to: effective_to || null, rel: relationship_to_member || 'self', notes: notes || null
      }
    });

    // Update patient default scheme if not set
    await sequelize.query(
      'UPDATE patients SET default_scheme_id = :sid WHERE (id = :pid OR patient_id = :pid) AND default_scheme_id IS NULL',
      { replacements: { sid: schemeId, pid: patient_id } }
    );

    res.status(201).json({ id, message: 'Patient added to scheme' });
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// List scheme members
router.get('/:id/members', async (req, res) => {
  try {
    // Schemes can be linked to either a main-registry patient or an LIS-registered
    // participant (the same "either source" pattern billing uses throughout the app) —
    // sm.patient_id may point at either table. Joining only `patients` left every LIS
    // participant showing as a raw UUID with no name at all.
    const [rows] = await sequelize.query(`
      SELECT sm.*,
        COALESCE((p.first_name || ' ' || p.last_name), (lp.first_name || ' ' || lp.last_name)) AS patient_name,
        COALESCE(p.patient_id, lp.participant_number) AS patient_number
      FROM scheme_membership sm
      LEFT JOIN patients p ON p.id = sm.patient_id
      LEFT JOIN lis_participants lp ON lp.id = sm.patient_id
      WHERE sm.scheme_id = :id
      ORDER BY sm.is_active DESC, sm.created_at DESC
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    console.error('Error listing scheme members:', error);
    res.status(500).json({ error: 'Failed to list members', details: error.message });
  }
});

// Update membership
router.put('/membership/:membershipId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const { member_number, effective_from, effective_to, is_active, verified, verified_by, relationship_to_member, notes } = req.body;
    const sets = [];
    const replacements = { id: req.params.membershipId };
    if (member_number !== undefined) { sets.push('member_number = :mnum'); replacements.mnum = member_number; }
    if (effective_from !== undefined) { sets.push('effective_from = :ef'); replacements.ef = effective_from; }
    if (effective_to !== undefined) { sets.push('effective_to = :et'); replacements.et = effective_to; }
    if (is_active !== undefined) { sets.push('is_active = :active'); replacements.active = is_active; }
    if (verified !== undefined) { sets.push('verified = :ver'); replacements.ver = verified; }
    if (verified_by !== undefined) { sets.push('verified_by = :vby'); replacements.vby = verified_by; sets.push('verified_date = CURRENT_DATE'); }
    if (relationship_to_member !== undefined) { sets.push('relationship_to_member = :rel'); replacements.rel = relationship_to_member; }
    if (notes !== undefined) { sets.push('notes = :notes'); replacements.notes = notes; }

    if (sets.length > 0) {
      await sequelize.query(`UPDATE scheme_membership SET ${sets.join(', ')} WHERE id = :id`, { replacements });
    }
    res.json({ message: 'Membership updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update membership' });
  }
});

// Remove membership
router.delete('/membership/:membershipId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query('UPDATE scheme_membership SET is_active = false WHERE id = :id', { replacements: { id: req.params.membershipId } });
    res.json({ message: 'Membership deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove membership' });
  }
});

// Get patient's schemes
router.get('/patient-schemes/:patientId', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT sm.*, ps.scheme_code, ps.scheme_name, ps.scheme_type, ps.is_insurance,
        ps.default_copay_percentage, ps.pricing_strategy, ps.base_markup_percentage, ps.base_discount_percentage
      FROM scheme_membership sm
      JOIN patient_schemes ps ON sm.scheme_id = ps.id
      WHERE (sm.patient_id = :pid) AND sm.is_active = true AND ps.is_active = true
      ORDER BY ps.is_default DESC
    `, { replacements: { pid: req.params.patientId } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get patient schemes' });
  }
});

// Assign scheme to patient
router.post('/patient-schemes/:patientId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const { scheme_id, clinic_id, member_number, effective_from } = req.body;
    const id = uuidv4();
    const cid = parseInt(clinic_id) || 1;

    await sequelize.query(`
      INSERT INTO scheme_membership (id, clinic_id, scheme_id, patient_id, member_number, effective_from, is_active)
      VALUES (:id, :cid, :sid, :pid, :mnum, :ef, true)
      ON CONFLICT (patient_id, scheme_id) DO UPDATE SET is_active = true, member_number = EXCLUDED.member_number
    `, {
      replacements: {
        id, cid, sid: scheme_id, pid: req.params.patientId,
        mnum: member_number || null, ef: effective_from || new Date().toISOString().split('T')[0]
      }
    });

    // Set as default scheme on patient
    await sequelize.query(
      'UPDATE patients SET default_scheme_id = :sid WHERE id = :pid OR patient_id = :pid',
      { replacements: { sid: scheme_id, pid: req.params.patientId } }
    );

    res.status(201).json({ id, message: 'Scheme assigned to patient' });
  } catch (error) {
    console.error('Error assigning scheme:', error);
    res.status(500).json({ error: 'Failed to assign scheme' });
  }
});

// ════════════════════════════════════════
// SERVICE PRICING PER SCHEME
// ════════════════════════════════════════

// Get all service prices for a scheme
router.get('/:id/service-pricing', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT ssp.*, s.service_name, NULL as service_code, s.category AS service_category, s.price AS base_price
      FROM scheme_service_pricing ssp
      JOIN services s ON ssp.service_id = s.id
      WHERE ssp.scheme_id = :id AND ssp.is_active = true
        AND (ssp.effective_to IS NULL OR ssp.effective_to >= CURRENT_DATE)
      ORDER BY s.category, s.service_name
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get service pricing' });
  }
});

// Get specific service price for scheme
router.get('/:id/service-pricing/:serviceId', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT ssp.*, s.service_name, s.price AS base_price
      FROM scheme_service_pricing ssp
      JOIN services s ON ssp.service_id = s.id
      WHERE ssp.scheme_id = :sid AND ssp.service_id = :svid AND ssp.is_active = true
        AND (ssp.effective_to IS NULL OR ssp.effective_to >= CURRENT_DATE)
      ORDER BY ssp.effective_from DESC LIMIT 1
    `, { replacements: { sid: req.params.id, svid: req.params.serviceId } });
    res.json(rows.length > 0 ? rows[0] : null);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get service price' });
  }
});

// Set service price for scheme
router.post('/:id/service-pricing', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const schemeId = req.params.id;
    const {
      clinic_id, service_id, scheme_price, scheme_currency,
      markup_percentage, discount_percentage,
      insurance_copay, insurance_copay_percentage, insurance_coverage_amount,
      effective_from, effective_to, notes, revenue_account_id
    } = req.body;
    const cid = parseInt(clinic_id) || 1;
    const id = uuidv4();

    // Deactivate previous pricing for same service/scheme
    await sequelize.query(`
      UPDATE scheme_service_pricing SET is_active = false
      WHERE scheme_id = :sid AND service_id = :svid AND is_active = true
    `, { replacements: { sid: schemeId, svid: service_id }, transaction: t });

    await sequelize.query(`
      INSERT INTO scheme_service_pricing (id, clinic_id, scheme_id, service_id,
        scheme_price, scheme_currency, markup_percentage, discount_percentage,
        insurance_copay, insurance_copay_percentage, insurance_coverage_amount,
        effective_from, effective_to, is_active, notes, revenue_account_id, created_by)
      VALUES (:id, :cid, :sid, :svid,
        :price, :curr, :markup, :disc,
        :copay, :copayPct, :coverage,
        :ef, :et, true, :notes, :revAcct, :by)
      ON CONFLICT (scheme_id, service_id, effective_from) DO UPDATE SET
        scheme_price = EXCLUDED.scheme_price, scheme_currency = EXCLUDED.scheme_currency,
        markup_percentage = EXCLUDED.markup_percentage, discount_percentage = EXCLUDED.discount_percentage,
        insurance_copay = EXCLUDED.insurance_copay, insurance_copay_percentage = EXCLUDED.insurance_copay_percentage,
        insurance_coverage_amount = EXCLUDED.insurance_coverage_amount,
        effective_to = EXCLUDED.effective_to, is_active = true, notes = EXCLUDED.notes,
        revenue_account_id = EXCLUDED.revenue_account_id
    `, {
      replacements: {
        id, cid, sid: schemeId, svid: service_id,
        price: scheme_price || null, curr: scheme_currency || 'SSP',
        markup: markup_percentage || 0, disc: discount_percentage || 0,
        copay: insurance_copay || null, copayPct: insurance_copay_percentage || null,
        coverage: insurance_coverage_amount || null,
        ef: effective_from || new Date().toISOString().split('T')[0], et: effective_to || null,
        notes: notes || null, revAcct: revenue_account_id || null, by: req.user?.id || null
      },
      transaction: t
    });

    // Price history
    await sequelize.query(`
      INSERT INTO scheme_service_pricing_history (id, scheme_id, service_id, new_price, new_copay,
        price_change_reason, effective_date, changed_by)
      VALUES (:id, :sid, :svid, :price, :copay, :reason, :ef, :by)
    `, {
      replacements: {
        id: uuidv4(), sid: schemeId, svid: service_id,
        price: scheme_price || null, copay: insurance_copay || null,
        reason: 'Price set', ef: effective_from || new Date().toISOString().split('T')[0],
        by: req.user?.id || null
      },
      transaction: t
    });

    await t.commit();
    res.status(201).json({ id, message: 'Service price set for scheme' });
  } catch (error) {
    await t.rollback();
    console.error('Error setting service price:', error);
    res.status(500).json({ error: 'Failed to set service price' });
  }
});

// Update service price
router.put('/:id/service-pricing/:pricingId', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const pricingId = req.params.pricingId;
    const [old] = await sequelize.query('SELECT * FROM scheme_service_pricing WHERE id = :id', { replacements: { id: pricingId }, transaction: t });
    if (old.length === 0) { await t.rollback(); return res.status(404).json({ error: 'Pricing not found' }); }

    const fields = ['scheme_price', 'markup_percentage', 'discount_percentage', 'insurance_copay',
      'insurance_copay_percentage', 'insurance_coverage_amount', 'effective_from', 'effective_to', 'notes'];
    const sets = [];
    const replacements = { id: pricingId };
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = :${f}`); replacements[f] = req.body[f]; }
    }
    if (sets.length > 0) {
      await sequelize.query(`UPDATE scheme_service_pricing SET ${sets.join(', ')} WHERE id = :id`, { replacements, transaction: t });
    }

    // Price history
    await sequelize.query(`
      INSERT INTO scheme_service_pricing_history (id, scheme_id, service_id, old_price, new_price, old_copay, new_copay,
        price_change_reason, effective_date, changed_by)
      VALUES (:id, :sid, :svid, :oldP, :newP, :oldC, :newC, :reason, CURRENT_DATE, :by)
    `, {
      replacements: {
        id: uuidv4(), sid: old[0].scheme_id, svid: old[0].service_id,
        oldP: old[0].scheme_price, newP: req.body.scheme_price ?? old[0].scheme_price,
        oldC: old[0].insurance_copay, newC: req.body.insurance_copay ?? old[0].insurance_copay,
        reason: req.body.price_change_reason || 'Price updated', by: req.user?.id || null
      }, transaction: t
    });

    await t.commit();
    res.json({ message: 'Service price updated' });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: 'Failed to update service price' });
  }
});

// Delete service price
router.delete('/:id/service-pricing/:pricingId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query('UPDATE scheme_service_pricing SET is_active = false WHERE id = :id', { replacements: { id: req.params.pricingId } });
    res.json({ message: 'Service price removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove service price' });
  }
});

// Bulk update service prices
router.post('/:id/service-pricing/bulk-update', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const schemeId = req.params.id;
    const { clinic_id, prices } = req.body; // prices: [{ service_id, scheme_price, markup_percentage, ... }]
    const cid = parseInt(clinic_id) || 1;
    let count = 0;

    for (const p of (prices || [])) {
      const id = uuidv4();
      // Deactivate old
      await sequelize.query(
        'UPDATE scheme_service_pricing SET is_active = false WHERE scheme_id = :sid AND service_id = :svid AND is_active = true',
        { replacements: { sid: schemeId, svid: p.service_id }, transaction: t }
      );
      await sequelize.query(`
        INSERT INTO scheme_service_pricing (id, clinic_id, scheme_id, service_id, scheme_price, markup_percentage,
          discount_percentage, insurance_copay, insurance_copay_percentage, effective_from, is_active, created_by)
        VALUES (:id, :cid, :sid, :svid, :price, :markup, :disc, :copay, :copayPct, CURRENT_DATE, true, :by)
        ON CONFLICT (scheme_id, service_id, effective_from) DO UPDATE SET
          scheme_price = EXCLUDED.scheme_price, markup_percentage = EXCLUDED.markup_percentage,
          discount_percentage = EXCLUDED.discount_percentage, insurance_copay = EXCLUDED.insurance_copay,
          insurance_copay_percentage = EXCLUDED.insurance_copay_percentage, is_active = true
      `, {
        replacements: {
          id, cid, sid: schemeId, svid: p.service_id,
          price: p.scheme_price || null, markup: p.markup_percentage || 0,
          disc: p.discount_percentage || 0, copay: p.insurance_copay || null,
          copayPct: p.insurance_copay_percentage || null, by: req.user?.id || null
        }, transaction: t
      });
      count++;
    }

    await t.commit();
    res.json({ message: `${count} service prices updated`, count });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: 'Failed to bulk update service prices' });
  }
});

// Service pricing history
router.get('/:id/service-pricing/:serviceId/history', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT h.*, u.display_name AS changed_by_name
      FROM scheme_service_pricing_history h
      LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.scheme_id = :sid AND h.service_id = :svid
      ORDER BY h.change_date DESC LIMIT 50
    `, { replacements: { sid: req.params.id, svid: req.params.serviceId } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get pricing history' });
  }
});

// Compare prices across schemes
router.get('/:id/service-pricing/compare', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const [rows] = await sequelize.query(`
      SELECT s.id AS service_id, s.service_name, NULL AS service_code, s.price AS base_price,
        ps.scheme_code, ps.scheme_name,
        ssp.scheme_price, ssp.markup_percentage, ssp.discount_percentage,
        ssp.insurance_copay, ssp.insurance_copay_percentage
      FROM services s
      CROSS JOIN patient_schemes ps
      LEFT JOIN scheme_service_pricing ssp ON ssp.service_id = s.id AND ssp.scheme_id = ps.id AND ssp.is_active = true
      WHERE s.clinic_id = :cid AND ps.clinic_id = :cid AND ps.is_active = true
      ORDER BY s.service_name, ps.scheme_name
    `, { replacements: { cid } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to compare prices' });
  }
});

// ════════════════════════════════════════
// PRODUCT/DRUG PRICING PER SCHEME
// ════════════════════════════════════════

// Get all product prices for a scheme
router.get('/:id/product-pricing', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT spp.*, ii.item_name AS product_name, ii.item_code AS product_code,
        ii.selling_price AS base_price, ii.current_unit_cost AS cost_price, ii.unit_of_measure,
        ii.quantity_on_hand AS stock_on_hand
      FROM scheme_product_pricing spp
      LEFT JOIN inventory_items ii ON spp.product_id = ii.id
      WHERE spp.scheme_id = :id AND spp.is_active = true
        AND (spp.effective_to IS NULL OR spp.effective_to >= CURRENT_DATE)
      ORDER BY ii.item_name
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    console.error('Error getting product pricing:', error);
    res.status(500).json({ error: 'Failed to get product pricing', details: error.message });
  }
});

// Set product price
router.post('/:id/product-pricing', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const schemeId = req.params.id;
    const {
      clinic_id, product_id, product_type, scheme_price, scheme_currency,
      markup_percentage, discount_percentage,
      insurance_copay, insurance_copay_percentage, insurance_coverage_amount,
      min_quantity, max_quantity, effective_from, effective_to, notes
    } = req.body;
    const cid = parseInt(clinic_id) || 1;
    const id = uuidv4();

    // Deactivate previous
    await sequelize.query(
      'UPDATE scheme_product_pricing SET is_active = false WHERE scheme_id = :sid AND product_id = :pid AND product_type = :pt AND is_active = true',
      { replacements: { sid: schemeId, pid: product_id, pt: product_type || 'drug' }, transaction: t }
    );

    await sequelize.query(`
      INSERT INTO scheme_product_pricing (id, clinic_id, scheme_id, product_id, product_type,
        scheme_price, scheme_currency, markup_percentage, discount_percentage,
        insurance_copay, insurance_copay_percentage, insurance_coverage_amount,
        min_quantity, max_quantity, effective_from, effective_to, is_active, notes, created_by)
      VALUES (:id, :cid, :sid, :pid, :pt,
        :price, :curr, :markup, :disc,
        :copay, :copayPct, :coverage,
        :minQty, :maxQty, :ef, :et, true, :notes, :by)
      ON CONFLICT (scheme_id, product_id, product_type, effective_from) DO UPDATE SET
        scheme_price = EXCLUDED.scheme_price, scheme_currency = EXCLUDED.scheme_currency,
        markup_percentage = EXCLUDED.markup_percentage, discount_percentage = EXCLUDED.discount_percentage,
        insurance_copay = EXCLUDED.insurance_copay, insurance_copay_percentage = EXCLUDED.insurance_copay_percentage,
        insurance_coverage_amount = EXCLUDED.insurance_coverage_amount,
        min_quantity = EXCLUDED.min_quantity, max_quantity = EXCLUDED.max_quantity,
        effective_to = EXCLUDED.effective_to, is_active = true, notes = EXCLUDED.notes
    `, {
      replacements: {
        id, cid, sid: schemeId, pid: product_id, pt: product_type || 'drug',
        price: scheme_price || null, curr: scheme_currency || 'SSP',
        markup: markup_percentage || 0, disc: discount_percentage || 0,
        copay: insurance_copay || null, copayPct: insurance_copay_percentage || null,
        coverage: insurance_coverage_amount || null,
        minQty: min_quantity || null, maxQty: max_quantity || null,
        ef: effective_from || new Date().toISOString().split('T')[0], et: effective_to || null,
        notes: notes || null, by: req.user?.id || null
      }, transaction: t
    });

    // History
    await sequelize.query(`
      INSERT INTO scheme_product_pricing_history (id, scheme_id, product_id, product_type, new_price, new_copay,
        price_change_reason, effective_date, changed_by)
      VALUES (:id, :sid, :pid, :pt, :price, :copay, 'Price set', :ef, :by)
    `, {
      replacements: {
        id: uuidv4(), sid: schemeId, pid: product_id, pt: product_type || 'drug',
        price: scheme_price || null, copay: insurance_copay || null,
        ef: effective_from || new Date().toISOString().split('T')[0], by: req.user?.id || null
      }, transaction: t
    });

    await t.commit();
    res.status(201).json({ id, message: 'Product price set for scheme' });
  } catch (error) {
    await t.rollback();
    console.error('Error setting product price:', error);
    res.status(500).json({ error: 'Failed to set product price' });
  }
});

// Update product price
router.put('/:id/product-pricing/:pricingId', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [old] = await sequelize.query('SELECT * FROM scheme_product_pricing WHERE id = :id', { replacements: { id: req.params.pricingId }, transaction: t });
    if (old.length === 0) { await t.rollback(); return res.status(404).json({ error: 'Pricing not found' }); }

    const fields = ['scheme_price', 'markup_percentage', 'discount_percentage', 'insurance_copay',
      'insurance_copay_percentage', 'insurance_coverage_amount', 'min_quantity', 'max_quantity',
      'effective_from', 'effective_to', 'notes'];
    const sets = [];
    const replacements = { id: req.params.pricingId };
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = :${f}`); replacements[f] = req.body[f]; }
    }
    if (sets.length > 0) {
      await sequelize.query(`UPDATE scheme_product_pricing SET ${sets.join(', ')} WHERE id = :id`, { replacements, transaction: t });
    }

    // History
    await sequelize.query(`
      INSERT INTO scheme_product_pricing_history (id, scheme_id, product_id, product_type,
        old_price, new_price, old_copay, new_copay, price_change_reason, effective_date, changed_by)
      VALUES (:id, :sid, :pid, :pt, :oldP, :newP, :oldC, :newC, :reason, CURRENT_DATE, :by)
    `, {
      replacements: {
        id: uuidv4(), sid: old[0].scheme_id, pid: old[0].product_id, pt: old[0].product_type,
        oldP: old[0].scheme_price, newP: req.body.scheme_price ?? old[0].scheme_price,
        oldC: old[0].insurance_copay, newC: req.body.insurance_copay ?? old[0].insurance_copay,
        reason: req.body.price_change_reason || 'Price updated', by: req.user?.id || null
      }, transaction: t
    });

    await t.commit();
    res.json({ message: 'Product price updated' });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: 'Failed to update product price' });
  }
});

// Delete product price
router.delete('/:id/product-pricing/:pricingId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query('UPDATE scheme_product_pricing SET is_active = false WHERE id = :id', { replacements: { id: req.params.pricingId } });
    res.json({ message: 'Product price removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove product price' });
  }
});

// Bulk update product prices
router.post('/:id/product-pricing/bulk-update', authorize(SCHEME_WRITE), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const schemeId = req.params.id;
    const { clinic_id, prices } = req.body;
    const cid = parseInt(clinic_id) || 1;
    let count = 0;

    for (const p of (prices || [])) {
      const id = uuidv4();
      await sequelize.query(
        'UPDATE scheme_product_pricing SET is_active = false WHERE scheme_id = :sid AND product_id = :pid AND is_active = true',
        { replacements: { sid: schemeId, pid: p.product_id }, transaction: t }
      );
      await sequelize.query(`
        INSERT INTO scheme_product_pricing (id, clinic_id, scheme_id, product_id, product_type,
          scheme_price, markup_percentage, discount_percentage, insurance_copay, insurance_copay_percentage,
          effective_from, is_active, created_by)
        VALUES (:id, :cid, :sid, :pid, :pt, :price, :markup, :disc, :copay, :copayPct, CURRENT_DATE, true, :by)
      `, {
        replacements: {
          id, cid, sid: schemeId, pid: p.product_id, pt: p.product_type || 'drug',
          price: p.scheme_price || null, markup: p.markup_percentage || 0,
          disc: p.discount_percentage || 0, copay: p.insurance_copay || null,
          copayPct: p.insurance_copay_percentage || null, by: req.user?.id || null
        }, transaction: t
      });
      count++;
    }

    await t.commit();
    res.json({ message: `${count} product prices updated`, count });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: 'Failed to bulk update product prices' });
  }
});

// ════════════════════════════════════════
// TIERED PRICING
// ════════════════════════════════════════

router.get('/:id/tiered-pricing', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT stp.*,
        COALESCE(s.service_name, ii.item_name) AS item_name
      FROM scheme_tiered_pricing stp
      LEFT JOIN services s ON stp.service_id = s.id
      LEFT JOIN inventory_items ii ON stp.product_id = ii.id
      WHERE stp.scheme_id = :id AND stp.is_active = true
      ORDER BY COALESCE(stp.service_id, stp.product_id), stp.tier_level
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get tiered pricing' });
  }
});

router.post('/:id/tiered-pricing', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const { clinic_id, service_id, product_id, product_type, tier_level, tier_name,
      min_quantity, max_quantity, tier_price, tier_currency, tier_discount_percentage,
      tier_copay, effective_from, effective_to } = req.body;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO scheme_tiered_pricing (id, clinic_id, scheme_id, service_id, product_id, product_type,
        tier_level, tier_name, min_quantity, max_quantity, tier_price, tier_currency,
        tier_discount_percentage, tier_copay, effective_from, effective_to, is_active, created_by)
      VALUES (:id, :cid, :sid, :svid, :pid, :pt,
        :level, :tname, :minQ, :maxQ, :price, :curr,
        :disc, :copay, :ef, :et, true, :by)
    `, {
      replacements: {
        id, cid: parseInt(clinic_id) || 1, sid: req.params.id,
        svid: service_id || null, pid: product_id || null, pt: product_type || null,
        level: tier_level || 1, tname: tier_name || null,
        minQ: min_quantity || 1, maxQ: max_quantity || null,
        price: tier_price, curr: tier_currency || 'SSP',
        disc: tier_discount_percentage || 0, copay: tier_copay || null,
        ef: effective_from || null, et: effective_to || null, by: req.user?.id || null
      }
    });
    res.status(201).json({ id, message: 'Tier added' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add tier' });
  }
});

router.put('/:id/tiered-pricing/:tierId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const fields = ['tier_level', 'tier_name', 'min_quantity', 'max_quantity', 'tier_price',
      'tier_discount_percentage', 'tier_copay', 'effective_from', 'effective_to', 'is_active'];
    const sets = [];
    const replacements = { id: req.params.tierId };
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = :${f}`); replacements[f] = req.body[f]; }
    }
    if (sets.length > 0) {
      await sequelize.query(`UPDATE scheme_tiered_pricing SET ${sets.join(', ')} WHERE id = :id`, { replacements });
    }
    res.json({ message: 'Tier updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tier' });
  }
});

router.delete('/:id/tiered-pricing/:tierId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query('UPDATE scheme_tiered_pricing SET is_active = false WHERE id = :id', { replacements: { id: req.params.tierId } });
    res.json({ message: 'Tier removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove tier' });
  }
});

// ════════════════════════════════════════
// SCHEME DISCOUNTS
// ════════════════════════════════════════

router.get('/:id/discounts', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT * FROM scheme_discounts WHERE scheme_id = :id AND is_active = true ORDER BY discount_name
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get discounts' });
  }
});

router.post('/:id/discounts', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const { clinic_id, discount_code, discount_type, discount_name, discount_value,
      applies_to, service_ids, product_ids, min_bill_amount, min_items_qty,
      effective_from, effective_to, requires_approval, approval_by_roles, notes } = req.body;
    const id = uuidv4();

    await sequelize.query(`
      INSERT INTO scheme_discounts (id, clinic_id, scheme_id, discount_code, discount_type, discount_name,
        discount_value, applies_to, service_ids, product_ids, min_bill_amount, min_items_qty,
        effective_from, effective_to, is_active, requires_approval, approval_by_roles, notes, created_by)
      VALUES (:id, :cid, :sid, :code, :dtype, :dname, :dval, :applies, :svids, :pids,
        :minAmt, :minQty, :ef, :et, true, :reqAppr, :apprRoles, :notes, :by)
    `, {
      replacements: {
        id, cid: parseInt(clinic_id) || 1, sid: req.params.id,
        code: discount_code, dtype: discount_type || 'percentage', dname: discount_name || null,
        dval: discount_value, applies: applies_to || 'all',
        svids: service_ids ? JSON.stringify(service_ids) : null,
        pids: product_ids ? JSON.stringify(product_ids) : null,
        minAmt: min_bill_amount || null, minQty: min_items_qty || null,
        ef: effective_from || null, et: effective_to || null,
        reqAppr: requires_approval || false,
        apprRoles: approval_by_roles ? JSON.stringify(approval_by_roles) : null,
        notes: notes || null, by: req.user?.id || null
      }
    });
    res.status(201).json({ id, message: 'Discount created' });
  } catch (error) {
    console.error('Error creating discount:', error);
    res.status(500).json({ error: 'Failed to create discount' });
  }
});

router.put('/:id/discounts/:discountId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const fields = ['discount_name', 'discount_type', 'discount_value', 'applies_to',
      'min_bill_amount', 'min_items_qty', 'effective_from', 'effective_to', 'is_active',
      'requires_approval', 'notes'];
    const sets = [];
    const replacements = { id: req.params.discountId };
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = :${f}`); replacements[f] = req.body[f]; }
    }
    if (sets.length > 0) {
      await sequelize.query(`UPDATE scheme_discounts SET ${sets.join(', ')} WHERE id = :id`, { replacements });
    }
    res.json({ message: 'Discount updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update discount' });
  }
});

router.delete('/:id/discounts/:discountId', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query('UPDATE scheme_discounts SET is_active = false WHERE id = :id', { replacements: { id: req.params.discountId } });
    res.json({ message: 'Discount deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete discount' });
  }
});

// ════════════════════════════════════════
// NEGOTIATED PRICES
// ════════════════════════════════════════

router.get('/:id/negotiated-prices', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT np.*, u.display_name AS negotiated_by_name, u2.display_name AS approved_by_name
      FROM scheme_negotiated_prices np
      LEFT JOIN users u ON u.id = np.negotiated_by_user_id
      LEFT JOIN users u2 ON u2.id = np.approved_by
      WHERE np.scheme_id = :id
      ORDER BY np.created_at DESC
    `, { replacements: { id: req.params.id } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get negotiated prices' });
  }
});

router.post('/:id/negotiated-prices', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const { clinic_id, applies_to, reference_id, negotiation_type, negotiated_price,
      original_price, valid_from, valid_to, quantity_limit, notes } = req.body;
    const id = uuidv4();
    const now = new Date();
    const negNum = `NEG-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${Date.now().toString().slice(-5)}`;

    const discAmt = (original_price || 0) - (negotiated_price || 0);
    const discPct = original_price > 0 ? (discAmt / original_price * 100) : 0;

    await sequelize.query(`
      INSERT INTO scheme_negotiated_prices (id, clinic_id, scheme_id, negotiation_number, negotiation_date,
        negotiated_by_user_id, applies_to, reference_id, negotiation_type,
        negotiated_price, original_price, discount_amount, discount_percentage,
        valid_from, valid_to, quantity_limit, status, notes)
      VALUES (:id, :cid, :sid, :num, CURRENT_DATE, :by, :applies, :ref, :ntype,
        :negPrice, :origPrice, :discAmt, :discPct,
        :vf, :vt, :qtyLimit, 'proposed', :notes)
    `, {
      replacements: {
        id, cid: parseInt(clinic_id) || 1, sid: req.params.id,
        num: negNum, by: req.user?.id || null,
        applies: applies_to || null, ref: reference_id || null,
        ntype: negotiation_type || 'custom',
        negPrice: negotiated_price, origPrice: original_price || null,
        discAmt: discAmt > 0 ? discAmt : 0, discPct: discPct > 0 ? discPct.toFixed(2) : 0,
        vf: valid_from || null, vt: valid_to || null, qtyLimit: quantity_limit || null,
        notes: notes || null
      }
    });
    res.status(201).json({ id, negotiation_number: negNum, message: 'Negotiated price proposed' });
  } catch (error) {
    console.error('Error creating negotiated price:', error);
    res.status(500).json({ error: 'Failed to create negotiated price' });
  }
});

router.put('/:id/negotiated-prices/:negId/approve', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query(`
      UPDATE scheme_negotiated_prices SET status = 'approved', approved_by = :by,
        approval_date = NOW(), approval_notes = :notes
      WHERE id = :id AND status = 'proposed'
    `, { replacements: { id: req.params.negId, by: req.user?.id || null, notes: req.body.approval_notes || null } });
    res.json({ message: 'Negotiated price approved' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve' });
  }
});

router.put('/:id/negotiated-prices/:negId/activate', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    await sequelize.query(`UPDATE scheme_negotiated_prices SET status = 'active' WHERE id = :id AND status = 'approved'`,
      { replacements: { id: req.params.negId } });
    res.json({ message: 'Negotiated price activated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate' });
  }
});

// ════════════════════════════════════════
// PRICE CALCULATION & LOOKUP
// ════════════════════════════════════════

// Get patient's effective scheme
async function getPatientScheme(patientId, clinicId) {
  // 1. Check scheme_membership
  const [memberships] = await sequelize.query(`
    SELECT sm.*, ps.*
    FROM scheme_membership sm
    JOIN patient_schemes ps ON sm.scheme_id = ps.id
    WHERE sm.patient_id = :pid AND sm.is_active = true AND ps.is_active = true
      AND (sm.effective_to IS NULL OR sm.effective_to >= CURRENT_DATE)
    ORDER BY ps.is_default DESC LIMIT 1
  `, { replacements: { pid: patientId } });
  if (memberships.length > 0) return memberships[0];

  // 2. Check patient.default_scheme_id
  const [patients] = await sequelize.query(
    'SELECT default_scheme_id FROM patients WHERE id = :pid OR patient_id = :pid LIMIT 1',
    { replacements: { pid: patientId } }
  );
  if (patients.length > 0 && patients[0].default_scheme_id) {
    const [schemes] = await sequelize.query('SELECT * FROM patient_schemes WHERE id = :id AND is_active = true',
      { replacements: { id: patients[0].default_scheme_id } });
    if (schemes.length > 0) return schemes[0];
  }

  // 3. Fall back to default scheme
  const cid = clinicId || 1;
  const [defaults] = await sequelize.query(
    'SELECT * FROM patient_schemes WHERE clinic_id = :cid AND is_default = true AND is_active = true LIMIT 1',
    { replacements: { cid } }
  );
  return defaults.length > 0 ? defaults[0] : null;
}

// Calculate price for patient + service
router.get('/pricing/patient/:patientId/service/:serviceId', async (req, res) => {
  try {
    const { quantity } = req.query;
    const qty = parseInt(quantity) || 1;
    const cid = parseInt(req.query.clinic_id) || 1;

    const scheme = await getPatientScheme(req.params.patientId, cid);
    const [services] = await sequelize.query('SELECT * FROM services WHERE id = :id LIMIT 1', { replacements: { id: req.params.serviceId } });
    if (services.length === 0) return res.status(404).json({ error: 'Service not found' });
    const service = services[0];
    const basePrice = parseFloat(service.price || 0);

    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'SSP';

    let finalPrice = basePrice;
    let priceCurrency = baseCurrency;
    let priceSource = 'base_price';
    let copayAmount = 0;
    let insurancePays = 0;

    if (scheme) {
      // Check tiered pricing first
      if (scheme.pricing_strategy === 'tiered') {
        const [tiers] = await sequelize.query(`
          SELECT * FROM scheme_tiered_pricing
          WHERE scheme_id = :sid AND service_id = :svid AND is_active = true
            AND min_quantity <= :qty AND (max_quantity IS NULL OR max_quantity >= :qty)
          ORDER BY tier_level ASC LIMIT 1
        `, { replacements: { sid: scheme.id || scheme.scheme_id, svid: req.params.serviceId, qty } });
        if (tiers.length > 0) {
          finalPrice = parseFloat(tiers[0].tier_price);
          priceCurrency = tiers[0].tier_currency || baseCurrency;
          priceSource = 'tiered_pricing';
          copayAmount = parseFloat(tiers[0].tier_copay || 0);
        }
      }

      if (priceSource === 'base_price') {
        // Check scheme service pricing
        const [ssp] = await sequelize.query(`
          SELECT * FROM scheme_service_pricing
          WHERE scheme_id = :sid AND service_id = :svid AND is_active = true
            AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
          ORDER BY effective_from DESC LIMIT 1
        `, { replacements: { sid: scheme.id || scheme.scheme_id, svid: req.params.serviceId } });

        if (ssp.length > 0 && ssp[0].scheme_price) {
          finalPrice = parseFloat(ssp[0].scheme_price);
          priceCurrency = ssp[0].scheme_currency || baseCurrency;
          priceSource = 'scheme_service_pricing';
          copayAmount = parseFloat(ssp[0].insurance_copay || 0);
          if (!copayAmount && ssp[0].insurance_copay_percentage) {
            copayAmount = finalPrice * parseFloat(ssp[0].insurance_copay_percentage) / 100;
          }
        } else if (scheme.pricing_strategy === 'percentage') {
          const markup = parseFloat(scheme.base_markup_percentage || 0);
          const discount = parseFloat(scheme.base_discount_percentage || 0);
          finalPrice = basePrice * (1 + (markup - discount) / 100);
          priceCurrency = baseCurrency;
          priceSource = 'scheme_percentage';
        }
      }

      // Insurance copay
      if (scheme.is_insurance && !copayAmount && scheme.default_copay_percentage > 0) {
        copayAmount = finalPrice * parseFloat(scheme.default_copay_percentage) / 100;
        if (scheme.copay_cap_per_visit) {
          copayAmount = Math.min(copayAmount, parseFloat(scheme.copay_cap_per_visit));
        }
      }

      if (scheme.is_insurance) {
        insurancePays = finalPrice - copayAmount;
      }
    }

    res.json({
      service_id: req.params.serviceId,
      service_name: service.service_name,
      base_price: basePrice,
      base_currency: baseCurrency,
      scheme_id: scheme?.id || scheme?.scheme_id || null,
      scheme_name: scheme?.scheme_name || 'Default',
      scheme_code: scheme?.scheme_code || null,
      final_price: Math.round(finalPrice * 100) / 100,
      currency: priceCurrency,
      price_source: priceSource,
      quantity: qty,
      line_total: Math.round(finalPrice * qty * 100) / 100,
      is_insurance: scheme?.is_insurance || false,
      copay_amount: Math.round(copayAmount * 100) / 100,
      insurance_pays: Math.round(insurancePays * 100) / 100,
      patient_pays: Math.round((scheme?.is_insurance ? copayAmount : finalPrice) * qty * 100) / 100
    });
  } catch (error) {
    console.error('Error calculating patient service price:', error);
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

// Calculate price for patient + product
router.get('/pricing/patient/:patientId/product/:productId', async (req, res) => {
  try {
    const qty = parseInt(req.query.quantity) || 1;
    const cid = parseInt(req.query.clinic_id) || 1;

    const scheme = await getPatientScheme(req.params.patientId, cid);
    const [products] = await sequelize.query('SELECT * FROM inventory_items WHERE id = :id LIMIT 1', { replacements: { id: req.params.productId } });
    if (products.length === 0) return res.status(404).json({ error: 'Product not found' });
    const product = products[0];
    const basePrice = parseFloat(product.selling_price || product.cost_price || 0);
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'SSP';

    let finalPrice = basePrice;
    let priceCurrency = baseCurrency;
    let priceSource = 'base_price';
    let copayAmount = 0;
    let insurancePays = 0;

    if (scheme) {
      // Check tiered pricing
      if (scheme.pricing_strategy === 'tiered') {
        const [tiers] = await sequelize.query(`
          SELECT * FROM scheme_tiered_pricing
          WHERE scheme_id = :sid AND product_id = :pid AND is_active = true
            AND min_quantity <= :qty AND (max_quantity IS NULL OR max_quantity >= :qty)
          ORDER BY tier_level ASC LIMIT 1
        `, { replacements: { sid: scheme.id || scheme.scheme_id, pid: req.params.productId, qty } });
        if (tiers.length > 0) {
          finalPrice = parseFloat(tiers[0].tier_price);
          priceCurrency = tiers[0].tier_currency || baseCurrency;
          priceSource = 'tiered_pricing';
          copayAmount = parseFloat(tiers[0].tier_copay || 0);
        }
      }

      if (priceSource === 'base_price') {
        const [spp] = await sequelize.query(`
          SELECT * FROM scheme_product_pricing
          WHERE scheme_id = :sid AND product_id = :pid AND is_active = true
            AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
          ORDER BY effective_from DESC LIMIT 1
        `, { replacements: { sid: scheme.id || scheme.scheme_id, pid: req.params.productId } });

        if (spp.length > 0 && spp[0].scheme_price) {
          finalPrice = parseFloat(spp[0].scheme_price);
          priceCurrency = spp[0].scheme_currency || baseCurrency;
          priceSource = 'scheme_product_pricing';
          copayAmount = parseFloat(spp[0].insurance_copay || 0);
          if (!copayAmount && spp[0].insurance_copay_percentage) {
            copayAmount = finalPrice * parseFloat(spp[0].insurance_copay_percentage) / 100;
          }
        } else if (scheme.pricing_strategy === 'percentage') {
          const markup = parseFloat(scheme.base_markup_percentage || 0);
          const discount = parseFloat(scheme.base_discount_percentage || 0);
          finalPrice = basePrice * (1 + (markup - discount) / 100);
          priceCurrency = baseCurrency;
          priceSource = 'scheme_percentage';
        }
      }

      if (scheme.is_insurance && !copayAmount && scheme.default_copay_percentage > 0) {
        copayAmount = finalPrice * parseFloat(scheme.default_copay_percentage) / 100;
        if (scheme.copay_cap_per_visit) copayAmount = Math.min(copayAmount, parseFloat(scheme.copay_cap_per_visit));
      }
      if (scheme.is_insurance) insurancePays = finalPrice - copayAmount;
    }

    res.json({
      product_id: req.params.productId,
      product_name: product.item_name,
      base_price: basePrice,
      base_currency: baseCurrency,
      scheme_id: scheme?.id || scheme?.scheme_id || null,
      scheme_name: scheme?.scheme_name || 'Default',
      final_price: Math.round(finalPrice * 100) / 100,
      currency: priceCurrency,
      price_source: priceSource,
      quantity: qty,
      line_total: Math.round(finalPrice * qty * 100) / 100,
      is_insurance: scheme?.is_insurance || false,
      copay_amount: Math.round(copayAmount * 100) / 100,
      insurance_pays: Math.round(insurancePays * 100) / 100,
      patient_pays: Math.round((scheme?.is_insurance ? copayAmount : finalPrice) * qty * 100) / 100
    });
  } catch (error) {
    console.error('Error calculating patient product price:', error);
    res.status(500).json({ error: 'Failed to calculate price' });
  }
});

// Get copay for service
router.get('/pricing/patient/:patientId/copay/:serviceId', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const scheme = await getPatientScheme(req.params.patientId, cid);

    if (!scheme || !scheme.is_insurance) {
      return res.json({ copay: 0, insurance_pays: 0, has_insurance: false });
    }

    const [services] = await sequelize.query('SELECT * FROM services WHERE id = :id LIMIT 1', { replacements: { id: req.params.serviceId } });
    if (services.length === 0) return res.status(404).json({ error: 'Service not found' });
    const basePrice = parseFloat(services[0].price || 0);

    // Get scheme service pricing
    const [ssp] = await sequelize.query(`
      SELECT * FROM scheme_service_pricing
      WHERE scheme_id = :sid AND service_id = :svid AND is_active = true
      ORDER BY effective_from DESC LIMIT 1
    `, { replacements: { sid: scheme.id || scheme.scheme_id, svid: req.params.serviceId } });

    let totalPrice = ssp.length > 0 && ssp[0].scheme_price ? parseFloat(ssp[0].scheme_price) : basePrice;
    let copay = 0;

    if (ssp.length > 0 && ssp[0].insurance_copay) {
      copay = parseFloat(ssp[0].insurance_copay);
    } else if (ssp.length > 0 && ssp[0].insurance_copay_percentage) {
      copay = totalPrice * parseFloat(ssp[0].insurance_copay_percentage) / 100;
    } else if (scheme.default_copay_percentage > 0) {
      copay = totalPrice * parseFloat(scheme.default_copay_percentage) / 100;
    }

    if (scheme.copay_cap_per_visit) copay = Math.min(copay, parseFloat(scheme.copay_cap_per_visit));

    res.json({
      has_insurance: true,
      scheme_name: scheme.scheme_name,
      total_price: totalPrice,
      copay: Math.round(copay * 100) / 100,
      insurance_pays: Math.round((totalPrice - copay) * 100) / 100
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate copay' });
  }
});

// Scheme-level price calculation
router.get('/pricing/scheme/:schemeId/service/:serviceId', async (req, res) => {
  try {
    const qty = parseInt(req.query.quantity) || 1;
    const [schemes] = await sequelize.query('SELECT * FROM patient_schemes WHERE id = :id', { replacements: { id: req.params.schemeId } });
    if (schemes.length === 0) return res.status(404).json({ error: 'Scheme not found' });
    const scheme = schemes[0];

    const [services] = await sequelize.query('SELECT * FROM services WHERE id = :id LIMIT 1', { replacements: { id: req.params.serviceId } });
    if (services.length === 0) return res.status(404).json({ error: 'Service not found' });
    const basePrice = parseFloat(services[0].price || 0);

    const [ssp] = await sequelize.query(`
      SELECT * FROM scheme_service_pricing
      WHERE scheme_id = :sid AND service_id = :svid AND is_active = true
      ORDER BY effective_from DESC LIMIT 1
    `, { replacements: { sid: req.params.schemeId, svid: req.params.serviceId } });

    let finalPrice = basePrice;
    if (ssp.length > 0 && ssp[0].scheme_price) finalPrice = parseFloat(ssp[0].scheme_price);
    else if (scheme.pricing_strategy === 'percentage') {
      finalPrice = basePrice * (1 + (parseFloat(scheme.base_markup_percentage) - parseFloat(scheme.base_discount_percentage)) / 100);
    }

    res.json({
      base_price: basePrice,
      scheme_price: Math.round(finalPrice * 100) / 100,
      scheme_name: scheme.scheme_name,
      quantity: qty,
      line_total: Math.round(finalPrice * qty * 100) / 100
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate scheme price' });
  }
});

// Bulk calculate
router.post('/pricing/bulk-calculate', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const { patient_id, clinic_id, items } = req.body; // items: [{ type: 'service'|'product', id, quantity }]
    const cid = parseInt(clinic_id) || 1;
    const scheme = await getPatientScheme(patient_id, cid);
    const results = [];
    let grandTotal = 0;
    let patientPays = 0;
    let insurancePays = 0;

    for (const item of (items || [])) {
      let basePrice = 0, finalPrice = 0, copay = 0;
      const qty = item.quantity || 1;

      if (item.type === 'service') {
        const [svc] = await sequelize.query('SELECT * FROM services WHERE id = :id LIMIT 1', { replacements: { id: item.id } });
        if (svc.length === 0) continue;
        basePrice = parseFloat(svc[0].price || 0);
        finalPrice = basePrice;

        if (scheme) {
          const [ssp] = await sequelize.query(`
            SELECT * FROM scheme_service_pricing WHERE scheme_id = :sid AND service_id = :svid AND is_active = true
            ORDER BY effective_from DESC LIMIT 1
          `, { replacements: { sid: scheme.id || scheme.scheme_id, svid: item.id } });
          if (ssp.length > 0 && ssp[0].scheme_price) {
            finalPrice = parseFloat(ssp[0].scheme_price);
            copay = parseFloat(ssp[0].insurance_copay || 0);
          } else if (scheme.pricing_strategy === 'percentage') {
            finalPrice = basePrice * (1 + (parseFloat(scheme.base_markup_percentage) - parseFloat(scheme.base_discount_percentage)) / 100);
          }
          if (scheme.is_insurance && !copay && scheme.default_copay_percentage > 0) {
            copay = finalPrice * parseFloat(scheme.default_copay_percentage) / 100;
          }
        }

        results.push({
          type: 'service', id: item.id, name: svc[0].service_name,
          base_price: basePrice, final_price: finalPrice, quantity: qty,
          line_total: finalPrice * qty, copay: copay * qty,
          insurance_pays: scheme?.is_insurance ? (finalPrice - copay) * qty : 0
        });
      } else {
        const [prod] = await sequelize.query('SELECT * FROM inventory_items WHERE id = :id LIMIT 1', { replacements: { id: item.id } });
        if (prod.length === 0) continue;
        basePrice = parseFloat(prod[0].selling_price || prod[0].cost_price || 0);
        finalPrice = basePrice;

        if (scheme) {
          const [spp] = await sequelize.query(`
            SELECT * FROM scheme_product_pricing WHERE scheme_id = :sid AND product_id = :pid AND is_active = true
            ORDER BY effective_from DESC LIMIT 1
          `, { replacements: { sid: scheme.id || scheme.scheme_id, pid: item.id } });
          if (spp.length > 0 && spp[0].scheme_price) {
            finalPrice = parseFloat(spp[0].scheme_price);
            copay = parseFloat(spp[0].insurance_copay || 0);
          } else if (scheme.pricing_strategy === 'percentage') {
            finalPrice = basePrice * (1 + (parseFloat(scheme.base_markup_percentage) - parseFloat(scheme.base_discount_percentage)) / 100);
          }
          if (scheme.is_insurance && !copay && scheme.default_copay_percentage > 0) {
            copay = finalPrice * parseFloat(scheme.default_copay_percentage) / 100;
          }
        }

        results.push({
          type: 'product', id: item.id, name: prod[0].item_name,
          base_price: basePrice, final_price: finalPrice, quantity: qty,
          line_total: finalPrice * qty, copay: copay * qty,
          insurance_pays: scheme?.is_insurance ? (finalPrice - copay) * qty : 0
        });
      }

      grandTotal += finalPrice * qty;
      patientPays += (scheme?.is_insurance ? copay : finalPrice) * qty;
      insurancePays += scheme?.is_insurance ? (finalPrice - copay) * qty : 0;
    }

    res.json({
      scheme: scheme ? { id: scheme.id || scheme.scheme_id, name: scheme.scheme_name, code: scheme.scheme_code } : null,
      items: results,
      grand_total: Math.round(grandTotal * 100) / 100,
      patient_pays: Math.round(patientPays * 100) / 100,
      insurance_pays: Math.round(insurancePays * 100) / 100
    });
  } catch (error) {
    console.error('Error bulk calculating prices:', error);
    res.status(500).json({ error: 'Failed to calculate prices' });
  }
});

// Compare price across schemes for a service
router.get('/pricing/compare/:serviceId', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const [services] = await sequelize.query('SELECT * FROM services WHERE id = :id LIMIT 1', { replacements: { id: req.params.serviceId } });
    if (services.length === 0) return res.status(404).json({ error: 'Service not found' });
    const basePrice = parseFloat(services[0].price || 0);

    const [schemes] = await sequelize.query('SELECT * FROM patient_schemes WHERE clinic_id = :cid AND is_active = true', { replacements: { cid } });
    const comparison = [];
    for (const scheme of schemes) {
      const [ssp] = await sequelize.query(`
        SELECT * FROM scheme_service_pricing WHERE scheme_id = :sid AND service_id = :svid AND is_active = true
        ORDER BY effective_from DESC LIMIT 1
      `, { replacements: { sid: scheme.id, svid: req.params.serviceId } });

      let schemePrice = basePrice;
      if (ssp.length > 0 && ssp[0].scheme_price) schemePrice = parseFloat(ssp[0].scheme_price);
      else if (scheme.pricing_strategy === 'percentage') {
        schemePrice = basePrice * (1 + (parseFloat(scheme.base_markup_percentage) - parseFloat(scheme.base_discount_percentage)) / 100);
      }

      comparison.push({
        scheme_id: scheme.id, scheme_code: scheme.scheme_code, scheme_name: scheme.scheme_name,
        base_price: basePrice, scheme_price: Math.round(schemePrice * 100) / 100,
        difference: Math.round((schemePrice - basePrice) * 100) / 100,
        difference_pct: basePrice > 0 ? Math.round((schemePrice - basePrice) / basePrice * 10000) / 100 : 0,
        copay: ssp.length > 0 ? parseFloat(ssp[0].insurance_copay || 0) : 0
      });
    }

    res.json({ service_name: services[0].service_name, base_price: basePrice, comparison });
  } catch (error) {
    res.status(500).json({ error: 'Failed to compare prices' });
  }
});

// ════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════

router.get('/reports/pricing-comparison', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    // services has no service_code or clinic_id column (it's a global catalog, not
    // clinic-scoped) — matches the same fix already applied to the two other
    // service-pricing queries in this file.
    const [rows] = await sequelize.query(`
      SELECT s.service_name, NULL AS service_code, s.price AS base_price,
        ps.scheme_code, ps.scheme_name, ssp.scheme_price,
        COALESCE(ssp.scheme_price, s.price) - s.price AS price_difference
      FROM services s
      CROSS JOIN patient_schemes ps
      LEFT JOIN scheme_service_pricing ssp ON ssp.service_id = s.id AND ssp.scheme_id = ps.id AND ssp.is_active = true
      WHERE ps.clinic_id = :cid AND ps.is_active = true
      ORDER BY s.service_name, ps.scheme_name
    `, { replacements: { cid } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get pricing comparison' });
  }
});

router.get('/reports/membership', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    const [rows] = await sequelize.query(`
      SELECT ps.scheme_code, ps.scheme_name, ps.scheme_type,
        COUNT(CASE WHEN sm.is_active = true THEN 1 END) AS active_members,
        COUNT(CASE WHEN sm.is_active = false THEN 1 END) AS inactive_members,
        COUNT(sm.id) AS total_members
      FROM patient_schemes ps
      LEFT JOIN scheme_membership sm ON sm.scheme_id = ps.id
      WHERE ps.clinic_id = :cid AND ps.is_active = true
      GROUP BY ps.id
      ORDER BY active_members DESC
    `, { replacements: { cid } });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get membership report' });
  }
});

router.get('/reports/margin-analysis', async (req, res) => {
  try {
    const cid = parseInt(req.query.clinic_id) || 1;
    // scheme_price can be in a different currency than the base service catalog price
    // (e.g. schemes priced in USD against an SSP base price list) — comparing the raw
    // numbers directly, as this query used to, produced nonsense margins (a $20 USD
    // scheme price read against a 20,000 SSP base price as a ~-99.9% margin). Convert
    // to base currency per row before computing margin.
    const AccountingService = require('../services/AccountingService');
    const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = true LIMIT 1`);
    const baseCurrency = baseCurrencyRow?.code || 'SSP';

    const [priceRows] = await sequelize.query(`
      SELECT ps.id AS scheme_id, ps.scheme_code, ps.scheme_name,
        ssp.scheme_price, ssp.scheme_currency, s.price AS base_price
      FROM patient_schemes ps
      LEFT JOIN scheme_service_pricing ssp ON ssp.scheme_id = ps.id AND ssp.is_active = true
      LEFT JOIN services s ON ssp.service_id = s.id
      WHERE ps.clinic_id = :cid AND ps.is_active = true
    `, { replacements: { cid } });

    const rateCache = {};
    const getRate = async (cur) => {
      if (cur === baseCurrency) return 1;
      if (rateCache[cur] !== undefined) return rateCache[cur];
      try {
        const rate = await AccountingService.getExchangeRate(cid, cur, baseCurrency, new Date());
        rateCache[cur] = rate;
        return rate;
      } catch (e) { rateCache[cur] = null; return null; }
    };

    const bySchemeId = {};
    for (const row of priceRows) {
      if (!bySchemeId[row.scheme_id]) {
        bySchemeId[row.scheme_id] = {
          scheme_code: row.scheme_code, scheme_name: row.scheme_name,
          services_priced: 0, margins: [], above_base: 0, below_base: 0, at_base: 0
        };
      }
      const bucket = bySchemeId[row.scheme_id];
      if (row.scheme_price == null || row.base_price == null || parseFloat(row.base_price) <= 0) continue;

      const cur = row.scheme_currency || baseCurrency;
      const rate = await getRate(cur);
      if (rate == null) continue; // no rate available — skip rather than blend currencies
      const basePriceEquivalent = parseFloat(row.scheme_price) * rate;
      const base = parseFloat(row.base_price);

      bucket.services_priced++;
      bucket.margins.push((basePriceEquivalent - base) / base * 100);
      if (basePriceEquivalent > base) bucket.above_base++;
      else if (basePriceEquivalent < base) bucket.below_base++;
      else bucket.at_base++;
    }

    const result = Object.values(bySchemeId)
      .map((b) => ({
        scheme_code: b.scheme_code, scheme_name: b.scheme_name,
        services_priced: b.services_priced,
        avg_margin_pct: b.margins.length ? b.margins.reduce((a, x) => a + x, 0) / b.margins.length : null,
        above_base: b.above_base, below_base: b.below_base, at_base: b.at_base
      }))
      .sort((a, b) => a.scheme_name.localeCompare(b.scheme_name));

    res.json(result);
  } catch (error) {
    console.error('Error getting margin analysis:', error);
    res.status(500).json({ error: 'Failed to get margin analysis' });
  }
});

// ════════════════════════════════════════
// BULK CSV PRICING UPLOAD
// ════════════════════════════════════════

router.post('/bulk-csv-pricing', authorize(SCHEME_WRITE), async (req, res) => {
  try {
    const { clinic_id, item_type, prices } = req.body;
    // prices: [{ scheme_id, item_id, scheme_price }]
    const cid = parseInt(clinic_id) || 1;
    const today = new Date().toISOString().split('T')[0];
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    // Cache scheme currencies to avoid repeated lookups
    const currencyCache = {};
    const [allSchemes] = await sequelize.query('SELECT id, currency FROM patient_schemes WHERE clinic_id = :cid', { replacements: { cid } });
    for (const s of allSchemes) { currencyCache[s.id] = s.currency || 'SSP'; }

    for (const p of (prices || [])) {
      if (!p.scheme_id || !p.item_id || p.scheme_price === '' || p.scheme_price === null || p.scheme_price === undefined) {
        skipped++;
        continue;
      }
      const price = parseFloat(p.scheme_price);
      if (isNaN(price)) { skipped++; continue; }

      const curr = currencyCache[p.scheme_id] || 'SSP';
      const id = uuidv4();

      try {
        if (item_type === 'service') {
          // Deactivate old prices for this specific item+scheme pair
          await sequelize.query(`
            UPDATE scheme_service_pricing SET is_active = false
            WHERE clinic_id = :cid AND scheme_id = :sid AND service_id = :svid AND is_active = true AND effective_from != :ef
          `, { replacements: { cid, sid: p.scheme_id, svid: p.item_id, ef: today } });

          await sequelize.query(`
            INSERT INTO scheme_service_pricing (id, clinic_id, scheme_id, service_id,
              scheme_price, scheme_currency, markup_percentage, discount_percentage,
              effective_from, is_active, created_by)
            VALUES (:id, :cid, :sid, :svid, :price, :curr, 0, 0, :ef, true, :by)
            ON CONFLICT (scheme_id, service_id, effective_from) DO UPDATE SET
              scheme_price = EXCLUDED.scheme_price, scheme_currency = EXCLUDED.scheme_currency, is_active = true
          `, {
            replacements: { id, cid, sid: p.scheme_id, svid: p.item_id, price, curr, ef: today, by: req.user?.id || null }
          });
        } else {
          // Deactivate old prices for this specific item+scheme pair
          await sequelize.query(`
            UPDATE scheme_product_pricing SET is_active = false
            WHERE clinic_id = :cid AND scheme_id = :sid AND product_id = :pid AND is_active = true AND effective_from != :ef
          `, { replacements: { cid, sid: p.scheme_id, pid: p.item_id, ef: today } });

          await sequelize.query(`
            INSERT INTO scheme_product_pricing (id, clinic_id, scheme_id, product_id, product_type,
              scheme_price, scheme_currency, markup_percentage, discount_percentage,
              effective_from, is_active, created_by)
            VALUES (:id, :cid, :sid, :pid, 'drug', :price, :curr, 0, 0, :ef, true, :by)
            ON CONFLICT (scheme_id, product_id, product_type, effective_from) DO UPDATE SET
              scheme_price = EXCLUDED.scheme_price, scheme_currency = EXCLUDED.scheme_currency, is_active = true
          `, {
            replacements: { id, cid, sid: p.scheme_id, pid: p.item_id, price, curr, ef: today, by: req.user?.id || null }
          });
        }
        saved++;
      } catch (err) {
        failed++;
        if (errors.length < 5) errors.push(`${p.item_id}: ${err.message}`);
      }
    }

    console.log(`Bulk CSV pricing: ${saved} saved, ${skipped} skipped, ${failed} failed out of ${(prices||[]).length} total`);
    res.json({ message: `${saved} prices saved, ${skipped} skipped, ${failed} failed`, saved, skipped, failed, errors });
  } catch (error) {
    console.error('Error bulk CSV pricing:', error);
    res.status(500).json({ error: 'Failed to bulk upload prices', details: error.message });
  }
});

// Export getPatientScheme for external use
router.getPatientScheme = getPatientScheme;

module.exports = router;
