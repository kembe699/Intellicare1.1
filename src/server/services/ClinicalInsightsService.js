/**
 * Clinical Insights — AI decision-support suggestions for a visit.
 *
 * Builds a de-identified summary of a lis_test_orders row (age, sex,
 * presenting complaint, vitals with normal ranges, lab results with
 * reference ranges/flags, current medications, and this visit's own notes —
 * never name, patient ID, phone, address, or exact date of birth), sends it
 * to the Anthropic Messages API, and validates the response against a fixed
 * JSON schema before it's ever shown to a clinician. Decision support only —
 * nothing here writes back to the patient record.
 */
const { v4: uuidv4 } = require('uuid');

const MODEL_DEFAULT = process.env.CLINICAL_INSIGHTS_MODEL || 'claude-sonnet-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const FETCH_TIMEOUT_MS = 60 * 1000;

const SYSTEM_PROMPT = `You are a clinical decision support assistant for hospitals in South Sudan. You assist qualified clinicians; you do not diagnose. Weight locally prevalent conditions appropriately (e.g. malaria, typhoid, tuberculosis, HIV-related illness, malnutrition, diarrhoeal disease) alongside general causes. Base every suggestion only on the data provided. If data is insufficient, say so. Be brief: a busy clinician is scanning this between patients, not reading a report — every field is a short phrase or one short sentence, never a paragraph. Call the submit_clinical_insights tool exactly once with your findings — do not write any other text.`;

// Forces the response through Anthropic's tool-use JSON schema rather than
// asking for raw JSON in prose: prompting alone ("respond ONLY with valid
// JSON") was unreliable in practice — real responses came back wrapped in a
// ```json fence, or used the model's own invented shape (e.g. a top-level
// "summary" field) instead of the required one. tool_choice below forces
// exactly this tool to be called, so the response is always a single
// structured input matching this schema, not prose to parse.
const CLINICAL_INSIGHTS_TOOL = {
  name: 'submit_clinical_insights',
  description: 'Submit the structured clinical decision-support findings for this visit.',
  input_schema: {
    type: 'object',
    properties: {
      urgent_flags: {
        type: 'array',
        description: 'Findings that need prompt clinician attention.',
        items: {
          type: 'object',
          properties: {
            finding: { type: 'string', description: 'A short phrase naming the finding — a few words, not a sentence.' },
            reason: { type: 'string', description: 'One short sentence: why this needs prompt attention.' },
          },
          required: ['finding', 'reason'],
        },
      },
      differentials: {
        type: 'array',
        description: 'Ranked candidate conditions, at most 5.',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            condition: { type: 'string', description: 'The condition name only.' },
            confidence: { type: 'string', enum: ['high', 'moderate', 'low'] },
            supporting_findings: { type: 'array', items: { type: 'string', description: 'A short phrase, not a sentence.' }, description: 'At most 3 short phrases.' },
            against_findings: { type: 'array', items: { type: 'string', description: 'A short phrase, not a sentence.' }, description: 'At most 3 short phrases; empty array if none.' },
            suggested_next_step: { type: 'string', description: 'One short, actionable sentence.' },
          },
          required: ['condition', 'confidence', 'supporting_findings', 'against_findings', 'suggested_next_step'],
        },
      },
      data_limitations: {
        type: 'string',
        description: 'One or two short sentences at most on what data would sharpen this assessment, or an empty string if none.',
      },
    },
    required: ['urgent_flags', 'differentials', 'data_limitations'],
  },
};

// ── Age-appropriate vital ranges ────────────────────────────────────────────
// Only HR and RR genuinely need age buckets for a clinically meaningful
// "normal" — temperature/SpO2 use one adult-equivalent band across ages,
// consistent with how this codebase already treats vitals generically
// elsewhere (see LISTestOrders.tsx's vitals display, which has no pediatric
// branching either). Buckets are inclusive of maxAge; the last bucket (no
// maxAge) catches everyone older.
const PULSE_RANGES = [
  { maxAge: 1, low: 100, high: 160 },
  { maxAge: 12, low: 70, high: 120 },
  { maxAge: Infinity, low: 60, high: 100 },
];
const RESP_RATE_RANGES = [
  { maxAge: 1, low: 30, high: 60 },
  { maxAge: 12, low: 20, high: 30 },
  { maxAge: Infinity, low: 12, high: 20 },
];
const TEMPERATURE_RANGE = { low: 36.1, high: 37.5 }; // °C
const SPO2_RANGE = { low: 94, high: 100 }; // %

function pickAgeRange(table, ageYears) {
  const age = Number.isFinite(ageYears) ? ageYears : 99;
  return table.find((b) => age <= b.maxAge) || table[table.length - 1];
}

function flagAgainst(value, range) {
  if (value < range.low) return 'low';
  if (value > range.high) return 'high';
  return 'normal';
}

function computeAgeYears(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return Math.max(age, 0);
}

// Clinical narrative fields (chief complaint, history, notes) are the one
// place a name or phone number can end up typed inline even though every
// other field in the payload is already structured and identifier-free by
// construction. Strips the patient's own first/last name (whole-word,
// case-insensitive) and any phone-number-shaped substring before the text
// ever leaves the building.
function redactFreeText(text, firstName, lastName) {
  if (!text) return text;
  let out = String(text);
  for (const name of [firstName, lastName]) {
    if (name && name.trim()) {
      const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '[redacted]');
    }
  }
  // Runs of 7+ digits, optionally grouped with spaces/dashes and an optional
  // leading +, e.g. "0912345678" or "+211 912 345 678".
  out = out.replace(/(\+?\d[\d\s-]{6,}\d)/g, '[redacted]');
  return out;
}

async function buildDeidentifiedPayload(sequelize, orderId) {
  const [[order]] = await sequelize.query(
    `SELECT o.id, o.participant_id, o.clinic_id, o.branch_id, o.clinical_notes, o.vitals, o.created_at,
            p.first_name, p.last_name, p.gender, p.date_of_birth
     FROM lis_test_orders o
     JOIN lis_participants p ON p.id = o.participant_id
     WHERE o.id = ?`,
    { replacements: [orderId] }
  );
  if (!order) return null;

  const vitalsRaw = typeof order.vitals === 'string' ? JSON.parse(order.vitals || '{}') : (order.vitals || {});
  const ageYears = computeAgeYears(order.date_of_birth);
  const redact = (t) => redactFreeText(t, order.first_name, order.last_name) || null;

  const vitals = [];
  const pulseVal = parseFloat(vitalsRaw.pulse);
  if (Number.isFinite(pulseVal)) {
    const r = pickAgeRange(PULSE_RANGES, ageYears);
    vitals.push({ name: 'Pulse', value: pulseVal, unit: 'bpm', normal_range: `${r.low}-${r.high}`, flag: flagAgainst(pulseVal, r) });
  }
  const rrVal = parseFloat(vitalsRaw.respiratory_rate);
  if (Number.isFinite(rrVal)) {
    const r = pickAgeRange(RESP_RATE_RANGES, ageYears);
    vitals.push({ name: 'Respiratory Rate', value: rrVal, unit: 'breaths/min', normal_range: `${r.low}-${r.high}`, flag: flagAgainst(rrVal, r) });
  }
  const tempVal = parseFloat(vitalsRaw.temperature);
  if (Number.isFinite(tempVal)) {
    vitals.push({ name: 'Temperature', value: tempVal, unit: '°C', normal_range: `${TEMPERATURE_RANGE.low}-${TEMPERATURE_RANGE.high}`, flag: flagAgainst(tempVal, TEMPERATURE_RANGE) });
  }
  const spo2Val = parseFloat(vitalsRaw.spo2);
  if (Number.isFinite(spo2Val)) {
    vitals.push({ name: 'SpO2', value: spo2Val, unit: '%', normal_range: `>=${SPO2_RANGE.low}`, flag: spo2Val < SPO2_RANGE.low ? 'low' : 'normal' });
  }
  if (vitalsRaw.blood_pressure) {
    // No pediatric BP centile table here — flagged against a fixed adult
    // band, the same simplification the vitals table itself already makes.
    const m = String(vitalsRaw.blood_pressure).match(/(\d+)\s*\/\s*(\d+)/);
    if (m) {
      const sys = parseInt(m[1], 10);
      const dia = parseInt(m[2], 10);
      const flag = (sys > 140 || dia > 90) ? 'high' : ((sys < 90 || dia < 60) ? 'low' : 'normal');
      vitals.push({ name: 'Blood Pressure', value: `${sys}/${dia}`, unit: 'mmHg', normal_range: '90-140/60-90', flag });
    }
  }

  // Lab results — only specimens whose results are approved/ready, each
  // analyte with its reference range + high/low flag from the catalog.
  const [specimens] = await sequelize.query(
    `SELECT id, test_name FROM lis_specimens WHERE order_id = ? AND status = 'approved'`,
    { replacements: [orderId] }
  );
  let labResults = [];
  if (specimens.length > 0) {
    const specimenIds = specimens.map((s) => s.id);
    const [results] = await sequelize.query(
      `SELECT r.specimen_id, r.analyte, r.value, r.unit, r.flag, c.reference_range
       FROM lis_results r
       LEFT JOIN lab_tests t ON r.test_code = t.test_code AND (t.branch_id = r.branch_id OR t.branch_id IS NULL)
       LEFT JOIN lab_test_components c ON t.id = c.lab_test_id AND r.analyte = c.component_name
       WHERE r.specimen_id IN (:specimenIds) AND r.status = 'approved'`,
      { replacements: { specimenIds } }
    );
    const nameBySpecimen = Object.fromEntries(specimens.map((s) => [s.id, s.test_name]));
    labResults = results.map((r) => ({
      test: nameBySpecimen[r.specimen_id] || null,
      analyte: r.analyte,
      value: r.value,
      unit: r.unit || null,
      reference_range: r.reference_range || null,
      flag: r.flag || null,
    }));
  }

  // Current medications — no FK from prescriptions to this specific order, so
  // matched by patient + same calendar day, the same best-effort join the
  // existing visit-summaries endpoint already uses.
  const orderDay = new Date(order.created_at).toISOString().split('T')[0];
  const [prescriptionLines] = await sequelize.query(
    `SELECT pp.prescription_date, pl.dose_strength, pl.dose_amount, pl.frequency, pl.duration_days,
            COALESCE(ii.item_name, pl.external_drug_name) as drug_name
     FROM pharmacy_prescriptions pp
     JOIN prescription_lines pl ON pl.prescription_id = pp.id
     LEFT JOIN inventory_items ii ON pl.drug_id = ii.id
     WHERE pp.patient_id = ? AND pp.status != 'cancelled' AND pl.status != 'cancelled'`,
    { replacements: [order.participant_id] }
  );
  const medications = prescriptionLines
    .filter((pl) => new Date(pl.prescription_date).toISOString().split('T')[0] === orderDay)
    .map((pl) => ({
      drug: pl.drug_name,
      dose: pl.dose_amount ? `${pl.dose_amount} ${pl.dose_strength || ''}`.trim() : (pl.dose_strength || null),
      frequency: pl.frequency || null,
      duration_days: pl.duration_days || null,
    }));

  return {
    age: ageYears,
    sex: order.gender || null,
    presenting_complaint: redact((vitalsRaw.chief_complaints || []).join('; ')),
    history: {
      history_of_presenting_illness: redact(vitalsRaw.history_of_presenting_illness),
      medical_history: redact(vitalsRaw.medical_history),
      surgical_history: redact(vitalsRaw.surgical_history),
      family_history: redact(vitalsRaw.family_history),
      social_history: redact(vitalsRaw.social_history),
      allergies: redact(vitalsRaw.allergies),
    },
    vitals,
    lab_results: labResults,
    current_medications: medications,
    doctor_notes: redact(order.clinical_notes),
  };
}

// ── Model call ──────────────────────────────────────────────────────────────

const MOCK_RESPONSE = {
  urgent_flags: [
    { finding: 'Elevated temperature with tachycardia', reason: 'Fever with tachycardia can indicate a serious infective process requiring prompt evaluation.' },
  ],
  differentials: [
    {
      condition: 'Malaria',
      confidence: 'moderate',
      supporting_findings: ['Fever', 'Region with known malaria prevalence'],
      against_findings: [],
      suggested_next_step: 'Malaria rapid diagnostic test or blood film',
    },
    {
      condition: 'Typhoid fever',
      confidence: 'low',
      supporting_findings: ['Fever'],
      against_findings: ['No reported diarrhoea'],
      suggested_next_step: 'Widal test or blood culture if available',
    },
  ],
  data_limitations: 'This is mock/sample output for local development — no real model was called.',
};

// Mock mode can never serve fabricated clinical output in production
// regardless of env misconfiguration.
function isMockMode() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.CLINICAL_INSIGHTS_MOCK === 'true';
}

async function callAnthropic(payload, model) {
  if (isMockMode()) {
    return { raw: JSON.stringify(MOCK_RESPONSE), modelUsed: `${model} (mock)` };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('Clinical Insights is not fully configured');
    err.isConfigError = true;
    throw err;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        // Headroom above what 5 differentials + urgent flags + data_limitations
        // typically need, so a verbose response doesn't get cut off mid-way —
        // truncated tool input fails parsing the same way malformed JSON
        // does, but for a completely different, budget-driven reason.
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
        tools: [CLINICAL_INSIGHTS_TOOL],
        tool_choice: { type: 'tool', name: CLINICAL_INSIGHTS_TOOL.name },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Never log the response body — it could echo back parts of the
      // request; the status code is enough to diagnose from server logs.
      const err = new Error(`Anthropic API error (${res.status})`);
      err.isApiError = true;
      throw err;
    }
    const data = await res.json();
    const toolBlock = (data.content || []).find((c) => c.type === 'tool_use' && c.name === CLINICAL_INSIGHTS_TOOL.name);
    // tool_choice forces exactly this tool, so `input` is already the parsed,
    // schema-shaped object — no JSON-in-prose to extract. Falling back to a
    // stray text block covers the (should-not-happen) case of the model not
    // calling the tool at all, so that still surfaces as a real, diagnosable
    // parse failure instead of silently returning nothing.
    const raw = toolBlock ? JSON.stringify(toolBlock.input) : ((data.content || []).find((c) => c.type === 'text')?.text || '');
    return { raw, modelUsed: model, truncated: data.stop_reason === 'max_tokens' };
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('Request to the model timed out');
      err.isTimeout = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Response validation ──────────────────────────────────────────────────────

// Claude models sometimes wrap structured output in a ```json ... ``` fence
// (or add a stray sentence before/after) even when told to respond with only
// JSON — a real, common quirk, not something a stricter prompt reliably
// prevents. Strips a fence if present, then falls back to the substring
// between the first "{" and the last "}" so a stray leading/trailing word
// doesn't fail parsing on otherwise-valid JSON.
function extractJsonText(raw) {
  let text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    text = fenced[1].trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text;
}

const CONFIDENCE_VALUES = new Set(['high', 'moderate', 'low']);

function validateInsightsShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Response was not a JSON object';
  if (!Array.isArray(parsed.urgent_flags)) return 'urgent_flags must be an array';
  for (const f of parsed.urgent_flags) {
    if (!f || typeof f.finding !== 'string' || typeof f.reason !== 'string') return 'Each urgent_flags entry needs finding/reason strings';
  }
  if (!Array.isArray(parsed.differentials)) return 'differentials must be an array';
  if (parsed.differentials.length > 5) return 'differentials must not exceed 5 entries';
  for (const d of parsed.differentials) {
    if (!d || typeof d.condition !== 'string') return 'Each differential needs a condition string';
    if (!CONFIDENCE_VALUES.has(d.confidence)) return 'Each differential needs confidence: high, moderate, or low';
    if (!Array.isArray(d.supporting_findings) || !Array.isArray(d.against_findings)) return 'supporting_findings/against_findings must be arrays';
    if (typeof d.suggested_next_step !== 'string') return 'Each differential needs a suggested_next_step string';
  }
  if (typeof parsed.data_limitations !== 'string') return 'data_limitations must be a string';
  return null;
}

function parseAndValidate(raw) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(raw));
  } catch (e) {
    return { error: 'Model did not return valid JSON' };
  }
  const shapeError = validateInsightsShape(parsed);
  if (shapeError) return { error: shapeError };
  return { data: parsed };
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function generateInsights(sequelize, { orderId, requestedBy, clinicId, branchId, model }) {
  const id = uuidv4();
  const useModel = model || MODEL_DEFAULT;
  await sequelize.query(
    `INSERT INTO clinical_insights (id, order_id, clinic_id, branch_id, requested_by, status, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())`,
    { replacements: [id, orderId, clinicId || null, branchId || null, requestedBy || null, useModel] }
  );

  // Fire-and-forget: the route responds with the pending row immediately, and
  // this continues in the background — no job queue in this codebase, so
  // this is the equivalent "the page never blocks" mechanism. The stuck-
  // pending sweep (clinicalInsightsSweeper.js) is the safety net if this
  // never reaches its own catch (e.g. process restart mid-call).
  (async () => {
    try {
      const payload = await buildDeidentifiedPayload(sequelize, orderId);
      if (!payload) {
        await sequelize.query(
          `UPDATE clinical_insights SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`,
          { replacements: ['Visit not found', id] }
        );
        return;
      }
      const { raw, modelUsed, truncated } = await callAnthropic(payload, useModel);
      const { data, error } = parseAndValidate(raw);
      if (error) {
        if (truncated) {
          await sequelize.query(
            `UPDATE clinical_insights SET status = 'failed', error_message = ?, model = ?, updated_at = NOW() WHERE id = ?`,
            { replacements: ['The model\'s response was cut off before it finished — please try again.', modelUsed, id] }
          );
          return;
        }
        // The failure reason alone ("Model did not return valid JSON") gives
        // no way to tell what actually went wrong without server console
        // access — which this feature deliberately never logs the model
        // response to (it can only be model output, not patient data, but
        // still). A short snippet of the actual response, stored here rather
        // than logged, lets the same clinician who made the request (and
        // support) see what the model returned without a hidden log to dig
        // through, and without ever printing the de-identified payload
        // itself anywhere.
        const snippet = String(raw || '').slice(0, 300).replace(/\s+/g, ' ').trim();
        const detailedMessage = snippet ? `${error} — response started with: "${snippet}"` : `${error} — the model returned an empty response`;
        await sequelize.query(
          `UPDATE clinical_insights SET status = 'failed', error_message = ?, model = ?, updated_at = NOW() WHERE id = ?`,
          { replacements: [detailedMessage, modelUsed, id] }
        );
        return;
      }
      await sequelize.query(
        `UPDATE clinical_insights SET status = 'completed', response = ?, model = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [JSON.stringify(data), modelUsed, id] }
      );
    } catch (e) {
      const message = e.isTimeout ? 'Timed out'
        : e.isConfigError ? 'Clinical Insights is not fully configured'
        : e.isApiError ? e.message
        : 'Failed to generate insights';
      try {
        await sequelize.query(
          `UPDATE clinical_insights SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`,
          { replacements: [message, id] }
        );
      } catch (_) { /* nothing more we can do */ }
    }
  })();

  return { id, status: 'pending' };
}

module.exports = {
  generateInsights,
  buildDeidentifiedPayload,
  redactFreeText,
  computeAgeYears,
  validateInsightsShape,
  parseAndValidate,
  extractJsonText,
  isMockMode,
  SYSTEM_PROMPT,
  MOCK_RESPONSE,
  CLINICAL_INSIGHTS_TOOL,
};
