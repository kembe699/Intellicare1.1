// Inter-store stock transfer requests: any department can view other storage
// locations and the items/quantities held there, submit a request to pull
// stock into their own location, and someone with fulfill-rights at the
// source location approves it — which performs the actual stock move
// between the two stock_by_location rows, reusing the exact row-locked
// decrement + upsert-credit mechanism already proven in routes/inventory.js's
// POST /transactions (transaction_type === 'transfer'). The clinic-wide
// inventory_items.quantity_on_hand total is deliberately left untouched,
// matching that same existing behavior.
//
// Tables: stock_transfer_requests (header) + stock_transfer_request_items
// (lines) + location_access (per-user per-location request/fulfill grants) —
// see scripts/migrateStockTransfers.js.
const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { authorize } = require('../middleware/authorize');
const { getBranchConditionSQL, getCreateBranchId } = require('../middleware/branchFilter');
const BranchQueryFilter = require('../services/BranchQueryFilter');
const { canRequestTo, canFulfillAt, getLocationAccess } = require('../utils/locationAccess');

// ---------------------------------------------------------------------------
// Stores + their stock, scoped broadly to stock_transfers.use (every role)
// rather than inventory.read (admin/pharmacy/finance/accountant/procurement
// only) — this is the one deliberate exception in this file, since browsing
// what another store holds is exactly what every department needs to decide
// where to request from.
// ---------------------------------------------------------------------------

router.get('/locations', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const branchFilter = getBranchConditionSQL(req, 'sl');
    const [locations] = await sequelize.query(`
      SELECT sl.id, sl.location_name, sl.location_type, sl.department_id, d.department_name
      FROM stock_locations sl
      LEFT JOIN departments d ON d.id = sl.department_id
      WHERE sl.clinic_id = ? AND sl.is_active = true${branchFilter.sql}
      ORDER BY sl.location_name ASC
    `, { replacements: [clinicId, ...branchFilter.params] });
    res.json(locations);
  } catch (error) {
    console.error('Error fetching stock transfer locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

router.get('/locations/:id/items', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [items] = await sequelize.query(`
      SELECT i.id, i.item_name, i.item_code, i.unit_of_measure, i.item_category,
        COALESCE(sbl.quantity_on_hand, 0) AS quantity_on_hand
      FROM inventory_items i
      JOIN stock_by_location sbl ON sbl.item_id = i.id AND sbl.location_id = :location_id
      WHERE i.clinic_id = :clinic_id AND i.is_active = true AND sbl.quantity_on_hand > 0
      ORDER BY i.item_name ASC
    `, { replacements: { clinic_id: clinicId, location_id: req.params.id } });
    res.json(items);
  } catch (error) {
    console.error('Error fetching items for location:', error);
    res.status(500).json({ error: 'Failed to fetch items for this location' });
  }
});

// ---------------------------------------------------------------------------
// Transfer requests
// ---------------------------------------------------------------------------

// Non-admins only see requests they raised, or requests whose source location
// they have fulfill-rights on (what they'd need to act on) — same shape as
// how requireApprovalPermission-gated lists scope themselves elsewhere.
async function visibilityClause(req, alias = 'str') {
  if (req.user?.role === 'admin') return { sql: '', replacements: {} };
  const [rows] = await sequelize.query(
    'SELECT location_id FROM location_access WHERE user_id = :userId AND can_fulfill = true',
    { replacements: { userId: req.user.id } }
  );
  const fulfillableLocationIds = rows.map(r => r.location_id);
  if (fulfillableLocationIds.length === 0) {
    return { sql: ` AND ${alias}.requested_by = :viewerUserId`, replacements: { viewerUserId: req.user.id } };
  }
  return {
    sql: ` AND (${alias}.requested_by = :viewerUserId OR ${alias}.from_location_id IN (:fulfillableLocationIds))`,
    replacements: { viewerUserId: req.user.id, fulfillableLocationIds },
  };
}

router.get('/', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const { status } = req.query;
    const conditions = ['str.clinic_id = :clinic_id'];
    const replacements = { clinic_id: clinicId };
    if (status) { conditions.push('str.status = :status'); replacements.status = status; }

    const visibility = await visibilityClause(req);
    Object.assign(replacements, visibility.replacements);

    const [requests] = await sequelize.query(`
      SELECT str.*,
        fl.location_name AS from_location_name, tl.location_name AS to_location_name,
        ru.display_name AS requested_by_name, au.display_name AS approved_by_name,
        (SELECT COUNT(*) FROM stock_transfer_request_items sti WHERE sti.transfer_request_id = str.id) AS item_count
      FROM stock_transfer_requests str
      LEFT JOIN stock_locations fl ON fl.id = str.from_location_id
      LEFT JOIN stock_locations tl ON tl.id = str.to_location_id
      LEFT JOIN users ru ON ru.id = str.requested_by
      LEFT JOIN users au ON au.id = str.approved_by
      WHERE ${conditions.join(' AND ')}${visibility.sql}
      ORDER BY str.created_at DESC
      LIMIT 500
    `, { replacements });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching stock transfer requests:', error);
    res.status(500).json({ error: 'Failed to fetch stock transfer requests' });
  }
});

router.get('/:id', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const [[request]] = await sequelize.query(`
      SELECT str.*,
        fl.location_name AS from_location_name, tl.location_name AS to_location_name,
        ru.display_name AS requested_by_name, au.display_name AS approved_by_name
      FROM stock_transfer_requests str
      LEFT JOIN stock_locations fl ON fl.id = str.from_location_id
      LEFT JOIN stock_locations tl ON tl.id = str.to_location_id
      LEFT JOIN users ru ON ru.id = str.requested_by
      LEFT JOIN users au ON au.id = str.approved_by
      WHERE str.id = :id
    `, { replacements: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Stock transfer request not found' });

    if (req.user?.role !== 'admin' && request.requested_by !== req.user?.id) {
      const access = await getLocationAccess(sequelize, req.user?.id, request.from_location_id);
      if (!access.can_fulfill) return res.status(403).json({ error: 'Access denied to this stock transfer request' });
    }

    const [items] = await sequelize.query(`
      SELECT sti.*, i.item_name, i.item_code, i.unit_of_measure
      FROM stock_transfer_request_items sti
      JOIN inventory_items i ON i.id = sti.inventory_item_id
      WHERE sti.transfer_request_id = :id
    `, { replacements: { id: req.params.id } });

    res.json({ ...request, items });
  } catch (error) {
    console.error('Error fetching stock transfer request:', error);
    res.status(500).json({ error: 'Failed to fetch stock transfer request' });
  }
});

router.post('/', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const { from_location_id, to_location_id, notes, items } = req.body;
    if (!from_location_id || !to_location_id || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'from_location_id, to_location_id, and at least one item are required' });
    }
    if (from_location_id === to_location_id) {
      return res.status(400).json({ error: 'Source and destination locations must be different' });
    }
    for (const line of items) {
      if (!line.inventory_item_id || !line.quantity_requested || parseFloat(line.quantity_requested) <= 0) {
        return res.status(400).json({ error: 'Each item needs an inventory_item_id and a positive quantity_requested' });
      }
    }

    if (!(await canRequestTo(sequelize, req, to_location_id))) {
      return res.status(403).json({ error: 'You do not have permission to request stock on behalf of this location' });
    }

    const clinicId = BranchQueryFilter.resolveClinicId(req);

    // Block over-requesting up front — same guard POST /transactions applies
    // before writing anything, so a rejected request never leaves a
    // half-written record behind.
    for (const line of items) {
      const [[stock]] = await sequelize.query(
        'SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :item_id AND location_id = :loc_id',
        { replacements: { item_id: line.inventory_item_id, loc_id: from_location_id } }
      );
      const available = parseFloat(stock?.quantity_on_hand) || 0;
      if (available < parseFloat(line.quantity_requested)) {
        return res.status(409).json({ error: `Not enough stock at the source location for one of the requested items (${available} available).` });
      }
    }

    const txDate = new Date().toISOString().split('T')[0];
    const [[countResult]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM stock_transfer_requests WHERE DATE(created_at) = CURRENT_DATE"
    );
    const seq = (parseInt(countResult?.cnt) || 0) + 1;
    const transfer_number = `TRF-${txDate.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;

    const id = uuidv4();
    await sequelize.transaction(async (t) => {
      await sequelize.query(`
        INSERT INTO stock_transfer_requests
          (id, clinic_id, transfer_number, from_location_id, to_location_id, requested_by, status, notes, branch_id)
        VALUES (:id, :clinic_id, :transfer_number, :from_location_id, :to_location_id, :requested_by, 'pending', :notes, :branch_id)
      `, {
        replacements: {
          id, clinic_id: clinicId, transfer_number, from_location_id, to_location_id,
          requested_by: req.user.id, notes: notes || null, branch_id: getCreateBranchId(req),
        },
        transaction: t,
      });

      for (const line of items) {
        await sequelize.query(`
          INSERT INTO stock_transfer_request_items (id, transfer_request_id, inventory_item_id, quantity_requested, notes)
          VALUES (:lineId, :requestId, :itemId, :qty, :lineNotes)
        `, {
          replacements: {
            lineId: uuidv4(), requestId: id, itemId: line.inventory_item_id,
            qty: line.quantity_requested, lineNotes: line.notes || null,
          },
          transaction: t,
        });
      }
    });

    res.status(201).json({ id, transfer_number, status: 'pending' });
  } catch (error) {
    console.error('Error creating stock transfer request:', error);
    res.status(500).json({ error: 'Failed to create stock transfer request' });
  }
});

router.post('/:id/approve', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const [[request]] = await sequelize.query(
      'SELECT * FROM stock_transfer_requests WHERE id = :id',
      { replacements: { id: req.params.id } }
    );
    if (!request) return res.status(404).json({ error: 'Stock transfer request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${request.status}` });
    }
    if (!(await canFulfillAt(sequelize, req, request.from_location_id))) {
      return res.status(403).json({ error: 'You do not have permission to fulfill requests from this location' });
    }

    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [lines] = await sequelize.query(
      'SELECT * FROM stock_transfer_request_items WHERE transfer_request_id = :id',
      { replacements: { id: req.params.id } }
    );

    await sequelize.transaction(async (t) => {
      for (const line of lines) {
        const [[source]] = await sequelize.query(
          'SELECT quantity_on_hand FROM stock_by_location WHERE item_id = :item_id AND location_id = :loc_id FOR UPDATE',
          { replacements: { item_id: line.inventory_item_id, loc_id: request.from_location_id }, transaction: t }
        );
        const available = parseFloat(source?.quantity_on_hand) || 0;
        const qty = parseFloat(line.quantity_requested);

        // Priced on the same basis as the stock-location valuation figure
        // elsewhere in this app (GET /inventory/locations), so a transfer
        // this screen triggers carries a real $ value into the Stock
        // Movement reports instead of the $0 a manual transfer defaults to
        // when nobody types a unit cost in by hand.
        const [[costRow]] = await sequelize.query(
          'SELECT current_unit_cost, average_unit_cost, cost_currency FROM inventory_items WHERE id = :item_id',
          { replacements: { item_id: line.inventory_item_id }, transaction: t }
        );
        const unitCost = parseFloat(costRow?.current_unit_cost) || parseFloat(costRow?.average_unit_cost) || 0;
        const totalCost = unitCost * qty;
        const costCurrency = costRow?.cost_currency || 'SSP';
        if (available < qty) {
          throw Object.assign(new Error(`Not enough stock remaining at the source location to fulfill this request (${available} available, ${qty} needed).`), { statusCode: 409 });
        }

        await sequelize.query(
          'UPDATE stock_by_location SET quantity_on_hand = quantity_on_hand - :qty WHERE item_id = :item_id AND location_id = :loc_id',
          { replacements: { qty, item_id: line.inventory_item_id, loc_id: request.from_location_id }, transaction: t }
        );

        await sequelize.query(`
          INSERT INTO stock_by_location (id, clinic_id, item_id, location_id, quantity_on_hand)
          VALUES (:sbl_id, :clinic_id, :item_id, :loc_id, :qty)
          ON CONFLICT (item_id, location_id) DO UPDATE
            SET quantity_on_hand = stock_by_location.quantity_on_hand + EXCLUDED.quantity_on_hand
        `, { replacements: { sbl_id: uuidv4(), clinic_id: clinicId, item_id: line.inventory_item_id, loc_id: request.to_location_id, qty }, transaction: t });

        await sequelize.query(`
          UPDATE stock_transfer_request_items SET quantity_fulfilled = :qty WHERE id = :lineId
        `, { replacements: { qty, lineId: line.id }, transaction: t });

        const txnId = uuidv4();
        await sequelize.query(`
          INSERT INTO inventory_transactions (id, clinic_id, transaction_number, item_id, transaction_type,
            quantity_change, from_location_id, to_location_id, unit_cost, total_cost, cost_currency,
            reference_type, reference_id, transaction_date, notes, created_by)
          VALUES (:id, :clinic_id, :transaction_number, :item_id, 'transfer',
            :qty, :from_location_id, :to_location_id, :unit_cost, :total_cost, :cost_currency,
            'stock_transfer_request', :reference_id, CURRENT_DATE, :notes, :created_by)
        `, {
          replacements: {
            id: txnId, clinic_id: clinicId, transaction_number: `${request.transfer_number}-${line.id.slice(0, 8)}`,
            item_id: line.inventory_item_id, qty, from_location_id: request.from_location_id,
            to_location_id: request.to_location_id, unit_cost: unitCost, total_cost: totalCost, cost_currency: costCurrency,
            reference_id: request.id, notes: `Stock transfer request ${request.transfer_number}`, created_by: req.user.id,
          },
          transaction: t,
        });
      }

      await sequelize.query(`
        UPDATE stock_transfer_requests
        SET status = 'approved', approved_by = :userId, approval_date = NOW(),
            fulfilled_by = :userId, fulfilled_date = NOW(), updated_at = NOW()
        WHERE id = :id
      `, { replacements: { userId: req.user.id, id: req.params.id }, transaction: t });
    });

    res.json({ id: req.params.id, status: 'approved' });
  } catch (error) {
    console.error('Error approving stock transfer request:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to approve stock transfer request' });
  }
});

router.post('/:id/reject', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const { rejection_reason } = req.body;
    const [[request]] = await sequelize.query(
      'SELECT * FROM stock_transfer_requests WHERE id = :id',
      { replacements: { id: req.params.id } }
    );
    if (!request) return res.status(404).json({ error: 'Stock transfer request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${request.status}` });
    }
    if (!(await canFulfillAt(sequelize, req, request.from_location_id))) {
      return res.status(403).json({ error: 'You do not have permission to act on requests from this location' });
    }

    await sequelize.query(`
      UPDATE stock_transfer_requests
      SET status = 'rejected', approved_by = :userId, approval_date = NOW(),
          rejection_reason = :reason, updated_at = NOW()
      WHERE id = :id
    `, { replacements: { userId: req.user.id, reason: rejection_reason || null, id: req.params.id } });

    res.json({ id: req.params.id, status: 'rejected' });
  } catch (error) {
    console.error('Error rejecting stock transfer request:', error);
    res.status(500).json({ error: 'Failed to reject stock transfer request' });
  }
});

router.post('/:id/cancel', authorize('stock_transfers.use'), async (req, res) => {
  try {
    const [[request]] = await sequelize.query(
      'SELECT * FROM stock_transfer_requests WHERE id = :id',
      { replacements: { id: req.params.id } }
    );
    if (!request) return res.status(404).json({ error: 'Stock transfer request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${request.status}` });
    }
    if (req.user?.role !== 'admin' && request.requested_by !== req.user?.id) {
      return res.status(403).json({ error: 'Only the requester or an admin can cancel this request' });
    }

    await sequelize.query(`
      UPDATE stock_transfer_requests SET status = 'cancelled', updated_at = NOW() WHERE id = :id
    `, { replacements: { id: req.params.id } });

    res.json({ id: req.params.id, status: 'cancelled' });
  } catch (error) {
    console.error('Error cancelling stock transfer request:', error);
    res.status(500).json({ error: 'Failed to cancel stock transfer request' });
  }
});

// ---------------------------------------------------------------------------
// Location access grants (admin/procurement-managed) — who can request on
// behalf of, or fulfill from, a given storage location.
// ---------------------------------------------------------------------------

router.get('/location-access/all', authorize('stock_transfers.manage'), async (req, res) => {
  try {
    const clinicId = BranchQueryFilter.resolveClinicId(req);
    const [grants] = await sequelize.query(`
      SELECT la.*, u.display_name AS user_name, u.email AS user_email, sl.location_name
      FROM location_access la
      JOIN users u ON u.id = la.user_id
      JOIN stock_locations sl ON sl.id = la.location_id
      WHERE la.clinic_id = :clinic_id
      ORDER BY sl.location_name ASC, u.display_name ASC
    `, { replacements: { clinic_id: clinicId } });
    res.json(grants);
  } catch (error) {
    console.error('Error fetching location access grants:', error);
    res.status(500).json({ error: 'Failed to fetch location access grants' });
  }
});

router.post('/location-access', authorize('stock_transfers.manage'), async (req, res) => {
  try {
    const { user_id, location_id, can_request, can_fulfill } = req.body;
    if (!user_id || !location_id) {
      return res.status(400).json({ error: 'user_id and location_id are required' });
    }
    const clinicId = BranchQueryFilter.resolveClinicId(req);

    await sequelize.query(`
      INSERT INTO location_access (id, clinic_id, user_id, location_id, can_request, can_fulfill)
      VALUES (DEFAULT, :clinic_id, :user_id, :location_id, :can_request, :can_fulfill)
      ON CONFLICT (user_id, location_id) DO UPDATE
        SET can_request = EXCLUDED.can_request, can_fulfill = EXCLUDED.can_fulfill, updated_at = NOW()
    `, {
      replacements: {
        clinic_id: clinicId, user_id, location_id,
        can_request: can_request !== false, can_fulfill: can_fulfill === true,
      },
    });

    res.status(201).json({ user_id, location_id });
  } catch (error) {
    console.error('Error granting location access:', error);
    res.status(500).json({ error: 'Failed to grant location access' });
  }
});

router.put('/location-access/:id', authorize('stock_transfers.manage'), async (req, res) => {
  try {
    const { can_request, can_fulfill } = req.body;
    await sequelize.query(`
      UPDATE location_access SET can_request = :can_request, can_fulfill = :can_fulfill, updated_at = NOW()
      WHERE id = :id
    `, { replacements: { can_request: can_request !== false, can_fulfill: can_fulfill === true, id: req.params.id } });
    res.json({ id: req.params.id });
  } catch (error) {
    console.error('Error updating location access:', error);
    res.status(500).json({ error: 'Failed to update location access' });
  }
});

router.delete('/location-access/:id', authorize('stock_transfers.manage'), async (req, res) => {
  try {
    await sequelize.query('DELETE FROM location_access WHERE id = :id', { replacements: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking location access:', error);
    res.status(500).json({ error: 'Failed to revoke location access' });
  }
});

module.exports = router;
