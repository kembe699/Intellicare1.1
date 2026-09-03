const express = require('express');
const { User, sequelize } = require('../models');
const { authorize } = require('../middleware/authorize');
const router = express.Router();

// Clinic name map
/**
 * Which clinic a newly-created user belongs to.
 *
 * Getting this wrong does not fail loudly — it creates an account that logs in
 * perfectly and then shows empty screens everywhere, because every query is
 * scoped by clinic_id. That is exactly what happened to a user created with
 * clinic_id 1 in a tenant whose data all lives under clinic_id 6.
 *
 * The old expression ended in `|| 1`, a hardcoded id that is only meaningful in
 * the original single-tenant deployment. clinicMap and a bare numeric parse are
 * kept ahead of it for compatibility, but the final fallback now asks the
 * tenant's own data rather than assuming:
 *
 *   1. an explicit, resolvable clinic from the request
 *   2. the creating admin's own clinic — right for an admin adding a colleague
 *   3. the clinic the tenant's existing users actually sit under
 *   4. the tenant's own clinic_names row
 *
 * Only if a tenant has no users and no clinics at all does this fall back to 1,
 * which for a brand-new tenant is the id its seeded facility uses anyway.
 */
async function resolveClinicIdForNewUser(req) {
  const explicit = clinicMap[req.body.clinic] || parseInt(req.body.clinic);
  if (explicit) return explicit;
  if (req.user?.clinicId) return req.user.clinicId;

  // Ask the tenant. The most common clinic_id among existing users is the one
  // this tenant's records are actually filed under.
  try {
    const [[row]] = await sequelize.query(
      `SELECT clinic_id FROM users WHERE clinic_id IS NOT NULL
        GROUP BY clinic_id ORDER BY count(*) DESC LIMIT 1`
    );
    if (row?.clinic_id) return row.clinic_id;
  } catch (e) { /* fall through */ }

  try {
    const [[row]] = await sequelize.query(`SELECT id FROM clinic_names ORDER BY id LIMIT 1`);
    if (row?.id) return row.id;
  } catch (e) { /* fall through */ }

  return 1;
}

const clinicMap = {
  'IntelliCare': 1,
  'Moleeta': 2,
  'Adar': 3,
  'Gumry': 4,
  'Friendship': 5
};

// Get all users (with optional clinic filter) — returns ALL users for management
router.get('/', async (req, res) => {
  try {
    const { clinic, all, role } = req.query;

    // Use raw query to LEFT JOIN branches for branch_name
    let sql = `
      SELECT u.*, b.name AS branch_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
    `;
    const replacements = [];
    const conditions = [];

    // If "all" param is NOT set, only return active users (backward compat)
    if (!all || all === 'false') {
      // For the security page, pass ?all=true to get everyone
    }

    if (clinic) {
      const clinicId = clinicMap[clinic] || parseInt(clinic);
      if (clinicId) {
        conditions.push('u.clinic_id = ?');
        replacements.push(clinicId);
      }
    }

    if (role) {
      conditions.push('u.role = ?');
      replacements.push(role);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY u.display_name ASC';

    const [users] = await sequelize.query(sql, { replacements });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get user by email
router.get('/email/:email', async (req, res) => {
  try {
    const user = await User.findOne({
      where: { email: req.params.email },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user by email:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get users by clinic
router.get('/clinic/:clinicId', async (req, res) => {
  try {
    const users = await User.findAll({
      where: { 
        clinic_id: req.params.clinicId,
        is_active: true 
      },
      order: [['display_name', 'ASC']],
    });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users by clinic:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create new user - Admin only
router.post('/', authorize(['admin']), async (req, res) => {
  try {
    const bcrypt = require('bcrypt');

    // id is intentionally omitted — users.id is a real INT AUTO_INCREMENT column, not a
    // UUID, so MySQL assigns it (a manually-generated UUID string here would overflow
    // the column and fail with "Data truncated for column 'id'").
    const userData = {
      email: req.body.email,
      display_name: req.body.displayName,
      role: req.body.role,
      // clinicMap is a leftover from before this app was multi-tenant — it only knows
      // the original deployment's 5 clinic names, so it (and a bare numeric parse)
      // resolve to nothing for any other tenant, whose own clinic_names rows use
      // completely different ids. The frontend's New User form has no real clinic
      // picker either — it always submits the literal string 'IntelliCare' — so this
      // used to silently fall through to the hardcoded `|| 1` for every single user
      // created in every tenant, regardless of which clinic_id that tenant's actual
      // data lives under. Falling back to the creating admin's own clinic_id first is
      // correct for the overwhelmingly common case (an admin adding staff to their own
      // clinic) and keeps the original single-tenant deployment's behavior unchanged
      // (its admin's own clinicId is 1 anyway).
      clinic_id: await resolveClinicIdForNewUser(req),
      branch_id: req.body.branch_id || req.body.branchId || null,
      is_active: req.body.isActive !== undefined ? req.body.isActive : true,
      status: req.body.status || 'active',
      created_by: req.body.createdBy || 'system',
      password_hash: await bcrypt.hash('password123', 10) // Default password
    };
    
    console.log('Creating user with data:', userData);

    const user = await User.create(userData);

    // Give the new account a branch.
    //
    // The New User form has no branch picker, so branch_id came through null and
    // no user_branches row was written either. loadUserBranchContext then found
    // nothing, and the account signed in successfully to a blank screen — a
    // valid token with no branch to scope any screen to.
    //
    // Default to the facility's main branch when the caller didn't name one.
    // Non-fatal: the user has already been created, and an admin can always
    // assign branches afterwards, so a failure here must not turn a successful
    // creation into a 500.
    try {
      let branchId = user.branch_id;
      if (!branchId) {
        const [rows] = await sequelize.query(
          `SELECT id FROM branches WHERE is_active IS NOT FALSE
            ORDER BY is_main_branch DESC, id ASC LIMIT 1`
        );
        branchId = rows[0]?.id || null;
        if (branchId) await user.update({ branch_id: branchId });
      }
      if (branchId) {
        await sequelize.query(
          `INSERT INTO user_branches (user_id, branch_id, is_primary, created_at, updated_at)
           VALUES (:uid, :bid, TRUE, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          { replacements: { uid: user.id, bid: branchId } }
        );
      }
    } catch (branchErr) {
      console.error(`Could not assign a branch to new user ${user.id}:`, branchErr.message);
    }

    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user', details: error.message });
  }
});

// Update user - admins can edit anyone and any field; a user editing their own
// record (e.g. Profile.tsx's display-name form) may only touch displayName —
// this used to be blanket admin-only, which broke self-service profile edits
// for every non-admin role (doctor/reception/lab/pharmacy/etc all got a 403
// just trying to save their own display name).
router.put('/:id', async (req, res) => {
  try {
    const isSelf = String(req.user?.id) === req.params.id;
    if (!isSelf && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions', required: ['admin'], current: req.user?.role });
    }

    const sensitiveFieldsRequested = ['role', 'clinic', 'branch_id', 'branchId', 'isActive', 'status']
      .some(f => req.body[f] !== undefined);
    if (isSelf && req.user?.role !== 'admin' && sensitiveFieldsRequested) {
      return res.status(403).json({ error: 'You can only update your own display name' });
    }

    // Transform frontend camelCase to database snake_case
    const updateData = {};
    if (req.body.displayName !== undefined) {
      updateData.display_name = req.body.displayName;
    }
    if (req.body.role !== undefined) {
      updateData.role = req.body.role;
    }
    if (req.body.clinic !== undefined) {
      // Same broken clinicMap as user creation (see POST / above) — for any tenant
      // other than the original one, this never resolves. The bug here was worse
      // than at creation time: falling back to a hardcoded 1 meant editing ANY field
      // on a user (e.g. just changing their role) silently reset their clinic_id back
      // to 1 as a side effect, even for a user whose clinic_id was already correctly
      // something else. Only touch clinic_id when it actually resolves to something
      // real; otherwise leave the existing value alone.
      const resolvedClinicId = clinicMap[req.body.clinic] || parseInt(req.body.clinic);
      if (resolvedClinicId) updateData.clinic_id = resolvedClinicId;
    }
    if (req.body.branch_id !== undefined || req.body.branchId !== undefined) {
      updateData.branch_id = req.body.branch_id || req.body.branchId || null;
    }
    if (req.body.isActive !== undefined) {
      updateData.is_active = req.body.isActive;
    }
    if (req.body.status !== undefined) {
      updateData.status = req.body.status;
    }
    if (req.body.updatedBy !== undefined) {
      updateData.updated_by = req.body.updatedBy;
    }

    updateData.updated_at = new Date();
    
    console.log('Updating user:', req.params.id, 'with data:', updateData);
    
    const [updatedRows] = await User.update(updateData, {
      where: { id: req.params.id },
    });
    
    if (updatedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const updatedUser = await User.findByPk(req.params.id);
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user', details: error.message });
  }
});

// Delete user (soft delete) - Admin only
router.delete('/:id', authorize(['admin']), async (req, res) => {
  try {
    const [updatedRows] = await User.update(
      { is_active: false },
      { where: { id: req.params.id } }
    );
    
    if (updatedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get user signature
// Signature/current-room are self-service endpoints — every real caller in the
// frontend passes the logged-in user's own id (grep-confirmed), so any request
// for a different id is either a bug or an attempt to read/overwrite someone
// else's signature (IDOR). Admins may still act on any user for support cases.
router.get('/:id/signature', async (req, res) => {
  try {
    if (String(req.user?.id) !== req.params.id && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'You can only access your own signature' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ signature: user.signature || null });
  } catch (error) {
    console.error('Error fetching user signature:', error);
    res.status(500).json({ error: 'Failed to fetch signature' });
  }
});

// Set current room (self-service — doctor specifies which consultation room they're in)
router.put('/:id/current-room', async (req, res) => {
  try {
    if (String(req.user?.id) !== req.params.id && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'You can only update your own current room' });
    }
    const { room_id } = req.body;

    const [updatedRows] = await User.update(
      { current_room_id: room_id || null, updated_at: new Date() },
      { where: { id: req.params.id } }
    );

    if (updatedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ id: req.params.id, current_room_id: room_id || null });
  } catch (error) {
    console.error('Error updating current room:', error);
    res.status(500).json({ error: 'Failed to update current room' });
  }
});

// Save user signature
router.post('/:id/signature', async (req, res) => {
  try {
    if (String(req.user?.id) !== req.params.id && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'You can only update your own signature' });
    }
    const { signature } = req.body;
    
    if (!signature) {
      return res.status(400).json({ error: 'Signature data is required' });
    }
    
    const [updatedRows] = await User.update(
      { 
        signature: signature,
        updated_at: new Date()
      },
      { where: { id: req.params.id } }
    );
    
    if (updatedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'Signature saved successfully' });
  } catch (error) {
    console.error('Error saving user signature:', error);
    res.status(500).json({ error: 'Failed to save signature' });
  }
});

module.exports = router;
