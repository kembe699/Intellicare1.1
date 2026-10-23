const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');

// Operating Theatre / OR module.
//
// Rooms are NOT owned here — an OR is just a row in the general `rooms`
// table (src/server/scripts/migrateInpatientTables.js) tagged
// room_type = 'or', added/edited from the existing /setup/rooms page like
// any ward or consultation room, rather than a second parallel place to
// register rooms. theatre_room_status is a small side table keyed by
// rooms.id that holds only the OR-specific live status (available/in_use/
// cleaning/maintenance) a ward room has no use for — everything else about
// the room (name, branch, active flag) is read straight from `rooms`.
// An early version of this module did keep its own theatre_rooms table;
// it never shipped to production, so it's dropped outright here rather than
// migrated.
//
// theatre_requests: a request from any department/ward for a patient to go to
// theatre — the intake queue. Scheduling one creates a theatre_operations row.
//
// theatre_operations: one row per actual operation, from scheduling through
// pre-op/in-progress/completed. patient_id is polymorphic — a patient can be
// identified either in `patients` (inpatient/reception identity) or
// `lis_participants` (the live OPD identity) — same dual-identity shape
// inpatient_admissions already uses (LEFT JOIN both, COALESCE the fields),
// not a strict FK to either table. theatre_room_id is likewise unconstrained,
// pointing at `rooms.id`.
//
// theatre_checklist_items: WHO Surgical Safety Checklist-style items, seeded
// per operation across three phases (pre_op / intra_op / post_op) so staff
// can tick them off; a custom item can also be added per operation.
//
// theatre_vitals: vitals readings taken during any phase of an operation —
// separate from the LIS/nursing vitals JSON blobs elsewhere in the app
// because an operation can have several readings over its course, not one.
//
// theatre_operation_items: drugs/consumables/blood used during an operation.
// Deducting stock and recording who/when/how much reuses the existing
// inventory_batches/batch_usage_history machinery (the same tables
// POST /api/inventory/batches/:id/use writes) rather than inventing a
// parallel stock ledger — this table is just the operation's own itemized
// view of that usage (denormalized item/location names included, so the
// operation report still reads correctly even if an item is later renamed).
async function migrateTheatreTables(db = sequelize) {
  console.log('\n=== Theatre / OR Module Migration ===\n');

  try { await db.query('DROP TABLE IF EXISTS theatre_rooms'); } catch (err) { console.error('Could not drop theatre_rooms:', err.message); }

  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_room_status (
      room_id CHAR(36) PRIMARY KEY,
      status VARCHAR(20) NOT NULL DEFAULT 'available',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT chk_theatre_room_status_value CHECK (status IN ('available', 'in_use', 'cleaning', 'maintenance'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_requests (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      patient_id CHAR(36) NOT NULL,
      requested_by VARCHAR(36),
      requesting_department VARCHAR(150),
      procedure_name VARCHAR(255) NOT NULL,
      diagnosis TEXT,
      priority VARCHAR(20) NOT NULL DEFAULT 'routine',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      notes TEXT,
      cancelled_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT chk_theatre_request_priority CHECK (priority IN ('routine', 'urgent', 'emergency')),
      CONSTRAINT chk_theatre_request_status CHECK (status IN ('pending', 'scheduled', 'cancelled'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_operations (
      id CHAR(36) PRIMARY KEY,
      clinic_id INTEGER NOT NULL,
      branch_id INTEGER,
      request_id CHAR(36),
      patient_id CHAR(36) NOT NULL,
      theatre_room_id CHAR(36),
      procedure_name VARCHAR(255) NOT NULL,
      surgeon_employee_id CHAR(36),
      anesthetist_employee_id CHAR(36),
      scrub_nurse_employee_id CHAR(36),
      scheduled_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      duration_minutes INTEGER,
      outcome VARCHAR(20),
      outcome_notes TEXT,
      cause_of_death TEXT,
      created_by VARCHAR(36),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT chk_theatre_operation_status CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
      CONSTRAINT chk_theatre_operation_outcome CHECK (outcome IS NULL OR outcome IN ('successful', 'complication', 'death', 'aborted'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_checklist_items (
      id CHAR(36) PRIMARY KEY,
      operation_id CHAR(36) NOT NULL,
      phase VARCHAR(20) NOT NULL,
      item_text VARCHAR(500) NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_checked BOOLEAN NOT NULL DEFAULT false,
      checked_by VARCHAR(36),
      checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT chk_theatre_checklist_phase CHECK (phase IN ('pre_op', 'intra_op', 'post_op'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_vitals (
      id CHAR(36) PRIMARY KEY,
      operation_id CHAR(36) NOT NULL,
      phase VARCHAR(20) NOT NULL,
      recorded_by VARCHAR(36),
      recorded_at TIMESTAMPTZ DEFAULT NOW(),
      blood_pressure VARCHAR(20),
      pulse INTEGER,
      temperature NUMERIC(4,1),
      respiratory_rate INTEGER,
      spo2 INTEGER,
      notes TEXT,
      CONSTRAINT chk_theatre_vitals_phase CHECK (phase IN ('pre_op', 'intra_op', 'post_op'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_operation_items (
      id CHAR(36) PRIMARY KEY,
      operation_id CHAR(36) NOT NULL,
      item_id CHAR(36) NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      batch_id CHAR(36),
      location_id CHAR(36),
      location_name VARCHAR(255),
      quantity NUMERIC(12,2) NOT NULL,
      unit_of_measure VARCHAR(50),
      dispensed_by VARCHAR(36),
      dispensed_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT,
      CONSTRAINT chk_theatre_operation_items_qty CHECK (quantity > 0)
    )
  `);

  // Full surgical team per operation — theatre_operations.surgeon_employee_id/
  // anesthetist_employee_id/scrub_nurse_employee_id (below) stay single-valued
  // and keep holding just the PRIMARY (first-added) person per role, so every
  // existing reader of those columns (the OR board list, getOperation's own
  // join, TheatreOperations.tsx, TheatreOperationDetail.tsx's summary lines)
  // keeps working unchanged. This table holds the full list — including that
  // same primary, duplicated — so the detail page's full-team section is a
  // self-contained read of just this one table.
  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_operation_team (
      id CHAR(36) PRIMARY KEY,
      operation_id CHAR(36) NOT NULL,
      employee_id CHAR(36) NOT NULL,
      role VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT chk_theatre_operation_team_role CHECK (role IN ('surgeon', 'anesthetist', 'scrub_nurse')),
      CONSTRAINT uq_theatre_operation_team UNIQUE (operation_id, employee_id, role)
    )
  `);

  // T2: this team member's cut of the operation's fee — set when they're
  // added to the team (pre-filled from employees.theatre_fee_percentage,
  // editable per operation since real splits vary case to case). The
  // hospital's own cut is never stored anywhere — it's just the fee minus
  // whatever the team's percentages add up to, computed on read, so there's
  // nothing to keep in sync if a percentage is edited later.
  try { await db.query(`ALTER TABLE theatre_operation_team ADD COLUMN IF NOT EXISTS fee_percentage NUMERIC(5,2)`); } catch (err) { console.error('Could not add theatre_operation_team.fee_percentage:', err.message); }

  // One row per team member per operation, computed once the operation
  // completes and its fee is billed (TheatreService.completeOperation) —
  // mirrors consultant_bill_items' one-row-per-event shape (ensureHRTables.js)
  // but per-operation instead of batched over a period, since the point here
  // is "this operation was done by X and Y, here's what each gets," visible
  // immediately. Paying one out is a separate, later cashier action (same
  // relationship payroll has between generating a run and paying a line) —
  // see POST /api/theatre/operations/:id/team-payouts/pay.
  await db.query(`
    CREATE TABLE IF NOT EXISTS theatre_team_payouts (
      id CHAR(36) PRIMARY KEY,
      operation_id CHAR(36) NOT NULL,
      employee_id CHAR(36) NOT NULL,
      role VARCHAR(20) NOT NULL,
      fee_percentage NUMERIC(5,2) NOT NULL,
      amount NUMERIC(15,2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'SSP',
      status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
      payment_account_id CHAR(36),
      gl_entry_id CHAR(36),
      paid_by INTEGER,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_theatre_team_payouts_status CHECK (status IN ('unpaid', 'paid')),
      CONSTRAINT uq_theatre_team_payouts UNIQUE (operation_id, employee_id, role)
    )
  `);
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_theatre_team_payouts_operation ON theatre_team_payouts (operation_id)`); } catch (err) { console.error('Index creation failed:', err.message); }

  // Safety net for a schema created before this file used TIMESTAMPTZ: a plain
  // TIMESTAMP column stores NOW() as a naive local wall-clock value (this
  // deployment's session timezone is UTC+3), which a JS Date then reads back
  // as if it WERE UTC — silently shifting every started_at/ended_at read by a
  // fixed 3 hours and making every operation's computed duration_minutes
  // wrong by exactly that offset. Caught by direct testing before this ever
  // reached production. CREATE TABLE IF NOT EXISTS above won't retype an
  // existing column, so re-assert TIMESTAMPTZ explicitly — a no-op once the
  // column already is one.
  const timestamptzColumns = [
    ['theatre_room_status', ['updated_at']],
    ['theatre_requests', ['created_at', 'updated_at']],
    ['theatre_operations', ['scheduled_at', 'started_at', 'ended_at', 'created_at', 'updated_at']],
    ['theatre_checklist_items', ['checked_at', 'created_at']],
    ['theatre_vitals', ['recorded_at']],
    ['theatre_operation_items', ['dispensed_at']],
  ];
  for (const [table, columns] of timestamptzColumns) {
    for (const column of columns) {
      try { await db.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TIMESTAMPTZ`); } catch (err) { console.error(`Could not retype ${table}.${column}:`, err.message); }
    }
  }

  // T1: lets a procedure's fee be captured at scheduling time and billed to
  // the patient once the operation completes (TheatreService.completeOperation)
  // — added after the table's initial creation, so existing rows get these as
  // NULL/false rather than needing a retype like the TIMESTAMPTZ columns above.
  const theatreOperationFeeColumns = [
    'ADD COLUMN IF NOT EXISTS procedure_fee NUMERIC(15,2)',
    "ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(3) NOT NULL DEFAULT 'SSP'",
    'ADD COLUMN IF NOT EXISTS bill_id CHAR(36)',
    'ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ',
  ];
  for (const clause of theatreOperationFeeColumns) {
    try { await db.query(`ALTER TABLE theatre_operations ${clause}`); } catch (err) { console.error(`Could not add theatre_operations column (${clause}):`, err.message); }
  }

  // Lets a request be billed at submission time (TheatreService.createRequest)
  // and hand that same bill straight to the operation it schedules into
  // (scheduleOperation copies bill_id onto the operation), so completeOperation's
  // existing `!bill_id` guard skips billing it a second time.
  const theatreRequestFeeColumns = [
    'ADD COLUMN IF NOT EXISTS service_id CHAR(36)',
    'ADD COLUMN IF NOT EXISTS estimated_fee NUMERIC(15,2)',
    "ADD COLUMN IF NOT EXISTS fee_currency VARCHAR(3) NOT NULL DEFAULT 'SSP'",
    'ADD COLUMN IF NOT EXISTS bill_id CHAR(36)',
    'ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ',
  ];
  for (const clause of theatreRequestFeeColumns) {
    try { await db.query(`ALTER TABLE theatre_requests ${clause}`); } catch (err) { console.error(`Could not add theatre_requests column (${clause}):`, err.message); }
  }

  // Lets the usage history and printable report show what kind of item was
  // used (drugs vs. everything else) — a copy of inventory_items.item_category
  // at the moment the item was recorded, so a later recategorization in
  // Inventory doesn't silently reclassify history.
  try { await db.query(`ALTER TABLE theatre_operation_items ADD COLUMN IF NOT EXISTS item_category VARCHAR(100)`); } catch (err) { console.error('Could not add theatre_operation_items.item_category:', err.message); }

  // Administer confirmation: recording usage (stock deduction + billing,
  // unchanged) and confirming an item was actually given to the patient are
  // two different facts — administered_at being set IS the "administered"
  // status, no separate enum needed. Both null means "recorded, not yet
  // confirmed administered".
  const theatreOperationItemAdministerColumns = [
    'ADD COLUMN IF NOT EXISTS administered_at TIMESTAMPTZ',
    'ADD COLUMN IF NOT EXISTS administered_by VARCHAR(36)',
    // Captured on confirm, not at Add time — route/dose/notes are a clinical
    // record of what was actually given (e.g. "IV", "5ml"), not an inventory
    // fact, and are only meaningful once administration is actually confirmed.
    'ADD COLUMN IF NOT EXISTS administered_route VARCHAR(50)',
    'ADD COLUMN IF NOT EXISTS administered_dose VARCHAR(100)',
    'ADD COLUMN IF NOT EXISTS administered_notes TEXT',
  ];
  for (const clause of theatreOperationItemAdministerColumns) {
    try { await db.query(`ALTER TABLE theatre_operation_items ${clause}`); } catch (err) { console.error(`Could not add theatre_operation_items column (${clause}):`, err.message); }
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_theatre_requests_clinic ON theatre_requests (clinic_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_requests_status ON theatre_requests (status)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_requests_branch ON theatre_requests (branch_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_operations_clinic ON theatre_operations (clinic_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_operations_status ON theatre_operations (status)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_operations_branch ON theatre_operations (branch_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_operations_room ON theatre_operations (theatre_room_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_operations_request ON theatre_operations (request_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_checklist_operation ON theatre_checklist_items (operation_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_vitals_operation ON theatre_vitals (operation_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_operation_items_operation ON theatre_operation_items (operation_id)',
    'CREATE INDEX IF NOT EXISTS idx_theatre_operation_team_operation ON theatre_operation_team (operation_id)',
  ];
  for (const idx of indexes) {
    try { await db.query(idx); } catch (err) { console.error('Index creation failed:', err.message); }
  }

  console.log('  ✅ theatre_room_status / theatre_requests / theatre_operations / theatre_checklist_items / theatre_vitals / theatre_operation_items ready');
  console.log('\n=== Theatre Migration Complete ===\n');
}

// WHO Surgical Safety Checklist, adapted — seeded onto every new operation by
// TheatreService.scheduleOperation, not here (this file only owns tables).
const CHECKLIST_TEMPLATE = {
  pre_op: [
    'Patient identity, procedure, and surgical site confirmed',
    'Surgical site marked (if applicable)',
    'Informed consent confirmed',
    'Anaesthesia safety check completed',
    'Pulse oximeter on patient and functioning',
    'Known allergies confirmed',
    'Difficult airway or aspiration risk assessed',
    'Risk of blood loss ≥500ml assessed — IV access/fluids planned',
  ],
  intra_op: [
    'All team members introduced by name and role',
    'Surgeon, anaesthetist and nurse verbally confirm patient, site and procedure',
    'Anticipated critical events reviewed',
    'Antibiotic prophylaxis given within the last 60 minutes (if indicated)',
    'Essential imaging displayed (if applicable)',
  ],
  post_op: [
    'Procedure performed recorded',
    'Instrument, sponge and needle counts confirmed correct',
    'Specimens labeled correctly (if applicable)',
    'Equipment problems addressed',
    'Key concerns for recovery and management reviewed',
  ],
};

module.exports = { migrateTheatreTables, CHECKLIST_TEMPLATE };
