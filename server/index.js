require("./env");
const path = require("path");
const fs = require("fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const { migrate, seedIfEmpty, ensurePayPeriods } = require("./seed");
const { computePay, dailyTotals } = require("./payroll");
const { verifyGoogleToken, GoogleAuthError } = require("./google");
const { config } = require("./config");
const paypal = require("./paypal");
const { syncTimeLogs, testConnection, getApiKey, getTimezone, demoModeOn, ClockifyError, SOURCE_SQL } = require("./timetracker");

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
if (!process.env.JWT_SECRET) console.warn("WARNING: JWT_SECRET is not set; using a development secret.");

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function audit(userId, action, table, recordId, oldValue, newValue) {
  await db.query(
    "INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value) VALUES ($1,$2,$3,$4,$5,$6)",
    [userId, action, table, recordId ?? null,
      oldValue == null ? null : typeof oldValue === "string" ? oldValue : JSON.stringify(oldValue),
      newValue == null ? null : typeof newValue === "string" ? newValue : JSON.stringify(newValue)]);
}

async function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please log in again." });
  }
  try {
    // A deactivated account (or a changed role) takes effect immediately, not when the token expires
    const u = (await db.query("SELECT role, status FROM users WHERE user_id=$1", [req.user.user_id])).rows[0];
    if (!u || u.status !== "active") return res.status(401).json({ error: "This account is no longer active." });
    req.user.role = u.role;
    next();
  } catch (e) { next(e); }
}
const ownerOnly = (req, res, next) =>
  req.user.role === "owner" ? next() : res.status(403).json({ error: "Only the Business Owner can do this." });

function bad(res, msg) { return res.status(400).json({ error: msg }); }

// ---------- auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

const GOOGLE_CLIENT_ID = config.googleClientId();

// Lockout after 5 failed passwords for 15 minutes (kept in memory; the Lab 005 USER entity has no lockout columns)
const failed = new Map(); // user_id -> { count, lockedUntil }
const LOCK_MS = 15 * 60 * 1000;
const isLocked = (id) => (failed.get(id)?.lockedUntil || 0) > Date.now();
function recordFailure(id) { // returns the attempt number, or 0 when this failure locks the account
  const f = failed.get(id) || { count: 0, lockedUntil: 0 };
  f.count += 1;
  const lock = f.count >= 5;
  if (lock) { f.lockedUntil = Date.now() + LOCK_MS; f.count = 0; }
  failed.set(id, f);
  return lock ? 0 : f.count;
}

function signIn(u) {
  const user = { user_id: u.user_id, full_name: u.full_name, email: u.email, role: u.role };
  return { token: jwt.sign(user, JWT_SECRET, { expiresIn: "8h" }), user };
}
function statusBlock(res, u) {
  if (u.status !== "active") return res.status(403).json({ error: "This account has been deactivated. Contact the Business Owner." });
  return null;
}

// Tells the login page which sign-in options are available
app.get("/api/auth/config", (req, res) => res.json({ google_client_id: GOOGLE_CLIENT_ID || null }));

// Sign in with Google: only for accounts that already exist, matched by email address
app.post("/api/auth/google", loginLimiter, wrap(async (req, res) => {
  let g;
  try { g = await verifyGoogleToken(req.body?.credential, GOOGLE_CLIENT_ID); }
  catch (e) { if (e instanceof GoogleAuthError) return res.status(401).json({ error: e.message }); throw e; }
  const u = (await db.query("SELECT * FROM users WHERE lower(email)=$1", [g.email])).rows[0];
  if (!u) return res.status(403).json({ error: `No IPTAS account uses ${g.email}. Ask the Business Owner to add you under User Accounts.` });
  const blocked = statusBlock(res, u); if (blocked) return;
  failed.delete(u.user_id);
  await audit(u.user_id, "LOGIN", "users", u.user_id, null, "Google");
  res.json(signIn(u));
}));

app.post("/api/auth/login", loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return bad(res, "Email and password are required.");
  const { rows } = await db.query("SELECT * FROM users WHERE lower(email)=lower($1)", [email.trim()]);
  const u = rows[0];
  if (!u || u.status === "inactive") return res.status(401).json({ error: "Invalid email or password." });
  if (isLocked(u.user_id))
    return res.status(423).json({ error: "Account locked after too many failed attempts. Try again in 15 minutes." });
  if (!bcrypt.compareSync(password, u.password_hash)) {
    const attempt = recordFailure(u.user_id);
    await audit(u.user_id, "LOGIN_FAILED", "users", u.user_id, null, attempt ? `Attempt ${attempt}` : "Account locked");
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const blocked = statusBlock(res, u); if (blocked) return;
  failed.delete(u.user_id);
  await audit(u.user_id, "LOGIN", "users", u.user_id, null, null);
  res.json(signIn(u));
}));

app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));

// ---------- users (owner) ----------
app.get("/api/users", auth, ownerOnly, wrap(async (req, res) => {
  const { rows } = await db.query("SELECT user_id, full_name, email, role, status, created_at FROM users ORDER BY user_id");
  res.json(rows);
}));

app.post("/api/users", auth, ownerOnly, wrap(async (req, res) => {
  const { full_name, email, password, role } = req.body || {};
  const e = nameError(full_name, "Full name") || emailError(email) || passwordError(password); if (e) return bad(res, e);
  if (!["owner", "admin"].includes(role)) return bad(res, "Role must be owner or admin.");
  const exists = await db.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email]);
  if (exists.rowCount) return bad(res, "A user with this email already exists.");
  const { rows } = await db.query(
    "INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING user_id, full_name, email, role, status",
    [full_name.trim(), email.trim(), bcrypt.hashSync(password, 10), role]);
  await audit(req.user.user_id, "CREATE_USER", "users", rows[0].user_id, null, { full_name, email, role });
  res.status(201).json(rows[0]);
}));

app.put("/api/users/:id", auth, ownerOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const old = (await db.query("SELECT user_id, full_name, email, role, status FROM users WHERE user_id=$1", [id])).rows[0];
  if (!old) return res.status(404).json({ error: "User not found." });
  const { role = old.role, status = old.status, password } = req.body || {};
  if (!["owner", "admin"].includes(role)) return bad(res, "Role must be owner or admin.");
  if (!["active", "inactive"].includes(status)) return bad(res, "Status must be active or inactive.");
  if (id === req.user.user_id && (status !== "active" || role !== "owner")) return bad(res, "You cannot deactivate or demote your own account.");
  if (password) { const pe = passwordError(password); if (pe) return bad(res, pe); }
  await db.query("UPDATE users SET role=$1, status=$2 WHERE user_id=$3", [role, status, id]);
  if (password) {
    await db.query("UPDATE users SET password_hash=$1 WHERE user_id=$2", [bcrypt.hashSync(password, 10), id]);
    failed.delete(id);
  }
  await audit(req.user.user_id, "UPDATE_USER", "users", id,
    { role: old.role, status: old.status }, { role, status, password_reset: !!password });
  res.json({ ok: true });
}));


// ---------- employees ----------
const EMP_FIELDS = ["tracker_user_id", "full_name", "email", "employment_type", "pay_rate", "currency", "overtime_eligible", "status", "date_hired"];

// ---------- validation (same rules as the forms in the browser) ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L} .,'’-]*$/u;
function nameError(v, label) {
  const s = String(v || "").trim();
  if (!s) return `${label} is required.`;
  if (s.length < 2 || s.length > 100) return `${label} must be 2 to 100 characters.`;
  if (!NAME_RE.test(s)) return `${label} can only contain letters, spaces, periods, apostrophes and hyphens.`;
  return null;
}
function emailError(v) {
  const s = String(v || "").trim();
  if (!s) return "Email is required.";
  if (s.length > 100 || !EMAIL_RE.test(s)) return "Please enter a valid email address (100 characters or fewer).";
  return null;
}
function passwordError(pw) {
  pw = String(pw || "");
  if (pw.length < 8 || pw.length > 72 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must be 8 to 72 characters with a letter and a number.";
  return null;
}
const decimals = (v) => (String(v).split(".")[1] || "").length;

function validateEmployee(b) {
  const e = nameError(b.full_name, "Full name") || emailError(b.email); if (e) return e;
  if (!["hourly", "fixed"].includes(b.employment_type)) return "Employment type must be hourly or fixed.";
  const rate = Number(b.pay_rate), max = b.employment_type === "hourly" ? 500 : 100000;
  if (!(rate > 0) || rate > max || decimals(b.pay_rate) > 2) return `Pay rate must be more than 0 and at most ${max}, with up to 2 decimals.`;
  if (!["CAD", "USD"].includes(b.currency)) return "Currency must be CAD or USD.";
  if (b.tracker_user_id && (/\s/.test(b.tracker_user_id) || String(b.tracker_user_id).length > 50)) return "The tracker user ID must be up to 50 characters with no spaces.";
  if (b.date_hired && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date_hired).slice(0, 10))) return "Enter a valid date hired.";
  if (!["active", "inactive"].includes(b.status)) return "Status must be active or inactive.";
  return null;
}
// Another employee with the same email or tracker ID (case-insensitive email)
async function employeeConflict(b, selfId) {
  const r = await db.query(
    "SELECT lower(email)=lower($1) AS email, (tracker_user_id IS NOT NULL AND tracker_user_id=$2) AS tracker FROM employees WHERE employee_id <> $3 AND (lower(email)=lower($1) OR tracker_user_id=$2) LIMIT 1",
    [String(b.email).trim(), b.tracker_user_id || null, selfId || 0]);
  if (!r.rows[0]) return null;
  return r.rows[0].email ? "Another employee already uses this email." : "Another employee already has this tracker user ID.";
}

app.get("/api/employees", auth, wrap(async (req, res) => {
  const { rows } = await db.query("SELECT * FROM employees ORDER BY status, full_name");
  res.json(rows);
}));

app.post("/api/employees", auth, wrap(async (req, res) => {
  const b = { overtime_eligible: true, status: "active", ...req.body };
  const err = validateEmployee(b) || (await employeeConflict(b, 0)); if (err) return bad(res, err);
  b.full_name = b.full_name.trim(); b.email = b.email.trim();
  if (!b.date_hired) b.date_hired = new Date().toISOString().slice(0, 10);
  if (!b.tracker_user_id) b.tracker_user_id = null;
  const { rows } = await db.query(
    `INSERT INTO employees (${EMP_FIELDS.join(",")}) VALUES (${EMP_FIELDS.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
    EMP_FIELDS.map((f) => b[f]));
  await audit(req.user.user_id, "CREATE_EMPLOYEE", "employees", rows[0].employee_id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

app.put("/api/employees/:id", auth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const old = (await db.query("SELECT * FROM employees WHERE employee_id=$1", [id])).rows[0];
  if (!old) return res.status(404).json({ error: "Employee not found." });
  const b = { ...old, ...req.body };
  const err = validateEmployee(b) || (await employeeConflict(b, id)); if (err) return bad(res, err);
  b.full_name = b.full_name.trim(); b.email = b.email.trim();
  if (!b.tracker_user_id) b.tracker_user_id = null;
  const { rows } = await db.query(
    `UPDATE employees SET ${EMP_FIELDS.map((f, i) => `${f}=$${i + 1}`).join(",")} WHERE employee_id=$${EMP_FIELDS.length + 1} RETURNING *`,
    [...EMP_FIELDS.map((f) => b[f]), id]);
  const changed = Object.fromEntries(EMP_FIELDS.filter((f) => String(old[f]) !== String(rows[0][f])).map((f) => [f, rows[0][f]]));
  const before = Object.fromEntries(Object.keys(changed).map((f) => [f, old[f]]));
  await audit(req.user.user_id, "UPDATE_EMPLOYEE", "employees", id, before, changed);
  res.json(rows[0]);
}));

// ---------- pay periods ----------
app.get("/api/periods", auth, wrap(async (req, res) => {
  await ensurePayPeriods();
  const { rows } = await db.query(
    `SELECT p.*, COALESCE(SUM(ROUND(pr.net_pay*pr.fx_rate,2)),0) AS total_net_cad, COUNT(pr.payroll_id)::int AS employees
       FROM pay_periods p LEFT JOIN payroll pr ON pr.period_id=p.period_id
      GROUP BY p.period_id ORDER BY p.start_date DESC`);
  res.json(rows);
}));

// ---------- time logs ----------
app.get("/api/timelogs", auth, wrap(async (req, res) => {
  const { period_id, employee_id } = req.query;
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [period_id])).rows[0];
  if (!p) return bad(res, "Select a pay period.");
  const params = [p.start_date, p.end_date];
  let where = "t.work_date BETWEEN $1 AND $2";
  if (employee_id) { params.push(employee_id); where += " AND t.employee_id=$3"; }
  const { rows } = await db.query(
    `SELECT t.*, ${SOURCE_SQL} AS source, e.full_name, e.overtime_eligible FROM time_logs t JOIN employees e ON e.employee_id=t.employee_id
      WHERE ${where} ORDER BY t.work_date DESC, e.full_name`, params);
  // Daily totals per employee: first overtime_threshold hours of a day are regular, the rest is overtime
  const rule = await ruleFor(p.end_date);
  const threshold = Number(rule?.overtime_threshold || 6);
  const byEmp = new Map();
  for (const l of rows) {
    if (!byEmp.has(l.employee_id)) byEmp.set(l.employee_id, { name: l.full_name, eligible: l.overtime_eligible, logs: [] });
    byEmp.get(l.employee_id).logs.push({ ...l, work_date: String(l.work_date).slice(0, 10) });
  }
  const daily = [];
  for (const [employee_id, e] of byEmp) {
    for (const d of dailyTotals(e.logs, threshold, e.eligible)) {
      const entries = e.logs.filter((l) => l.work_date === d.work_date)
        .map((l) => ({ log_id: l.log_id, start_time: l.start_time, end_time: l.end_time, hours: Number(l.hours_worked), source: l.source }))
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
      daily.push({ employee_id, full_name: e.name, ...d, entries });
    }
  }
  daily.sort((a, b) => b.work_date.localeCompare(a.work_date) || a.full_name.localeCompare(b.full_name));
  res.json({
    period: p, logs: rows, daily, overtime_threshold: threshold, last_sync: await lastSync(),
    timezone: await getTimezone(), clockify_connected: !!(await getApiKey()), demo_mode: await demoModeOn(),
  });
}));

// When hours change after payroll was computed, that payroll is out of date: clear it so it must be recomputed
async function invalidatePayroll(periodId) {
  const r = await db.query("UPDATE pay_periods SET status='open' WHERE period_id=$1 AND status='computed' RETURNING period_id", [periodId]);
  if (r.rowCount) await db.query("DELETE FROM payroll WHERE period_id=$1", [periodId]);
  return r.rowCount > 0;
}

// The last sync is the newest SYNC_TIME_LOGS entry in the audit trail
async function lastSync() {
  const r = await db.query("SELECT new_value FROM audit_log WHERE action='SYNC_TIME_LOGS' ORDER BY logged_at DESC, audit_id DESC LIMIT 1");
  try { return r.rows[0] ? JSON.parse(r.rows[0].new_value) : null; } catch { return null; }
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z"));


// Pulls the period's hours from Clockify (process 3.0). Used by "Sync time logs" and automatically by "Compute payroll".
// Throws ClockifyError (already audit-logged) when the sync fails.
async function syncPeriod(userId, p) {
  let result;
  try {
    result = await syncTimeLogs(p.start_date, p.end_date);
  } catch (e) {
    if (e instanceof ClockifyError) await audit(userId, "SYNC_FAILED", "time_logs", p.period_id, null, e.message);
    throw e;
  }
  const info = { ...result, at: new Date().toISOString(), period: `${p.start_date} to ${p.end_date}` };
  await audit(userId, "SYNC_TIME_LOGS", "time_logs", p.period_id, null, info);
  return info;
}

// Scheduled sync (DFD 3.0 "runs on a schedule or on demand"): every 30 minutes, open pay periods that are
// current or ended in the last 14 days get their latest Clockify hours. Not written to the audit trail.
const SYNC_EVERY_MS = 30 * 60 * 1000;
async function scheduledSync() {
  try {
    if (!(await getApiKey())) return;
    await ensurePayPeriods();
    const today = new Date().toISOString().slice(0, 10);
    const ps = (await db.query(
      "SELECT * FROM pay_periods WHERE status='open' AND start_date <= $1 AND end_date >= ($1::date - 14) ORDER BY start_date", [today])).rows;
    for (const p of ps) {
      const r = await syncTimeLogs(p.start_date, p.end_date);
      console.log(`Scheduled sync ${p.start_date} to ${p.end_date}: ${r.synced} entries`);
    }
  } catch (e) { console.error("Scheduled sync failed:", e.message); }
}

app.post("/api/timelogs/sync", auth, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.body?.period_id])).rows[0];
  if (!p) return bad(res, "Select a pay period.");
  if (p.status === "approved") return bad(res, "This pay period is already approved and locked.");
  let info;
  try { info = await syncPeriod(req.user.user_id, p); }
  catch (e) { if (e instanceof ClockifyError) return res.status(502).json({ error: "Time-log sync failed: " + e.message }); throw e; }
  info.payroll_reset = await invalidatePayroll(p.period_id);
  res.json(info);
}));

// ---------- pay rules ----------
app.get("/api/rules", auth, wrap(async (req, res) => {
  const { rows } = await db.query("SELECT * FROM pay_rules ORDER BY effective_date DESC, rule_id DESC");
  res.json(rows);
}));

app.post("/api/rules", auth, ownerOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const nums = ["overtime_threshold", "overtime_multiplier", "cpp_rate", "ei_rate"];
  for (const n of nums) if (!(Number(b[n]) >= 0)) return bad(res, `Please enter a valid value for ${n.replace(/_/g, " ")}.`);
  if (Number(b.overtime_threshold) < 1 || Number(b.overtime_threshold) > 24 || Number(b.overtime_multiplier) < 1 || Number(b.overtime_multiplier) > 3)
    return bad(res, "Overtime starts after 1 to 24 hours a day, and the multiplier must be between 1 and 3.");
  if (b.rule_name && String(b.rule_name).trim().length > 50) return bad(res, "The rule name must be 50 characters or fewer.");
  if (b.effective_date && (!/^\d{4}-\d{2}-\d{2}$/.test(b.effective_date) || isNaN(new Date(b.effective_date + "T00:00:00Z")))) return bad(res, "Enter a valid effective date.");
  if (Number(b.cpp_rate) > 0.2 || Number(b.ei_rate) > 0.2) return bad(res, "Enter CPP and EI rates as decimals (e.g. 0.0595 for 5.95%).");
  const { rows } = await db.query(
    `INSERT INTO pay_rules (rule_name, overtime_threshold, overtime_multiplier, cpp_rate, ei_rate, effective_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [String(b.rule_name || "").trim() || "Updated rules", ...nums.map((n) => b[n]), b.effective_date || new Date().toISOString().slice(0, 10)]);
  await audit(req.user.user_id, "UPDATE_PAY_RULES", "pay_rules", rows[0].rule_id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

// ---------- payroll ----------
async function ruleFor(endDate) {
  const r = await db.query("SELECT * FROM pay_rules WHERE effective_date <= $1 ORDER BY effective_date DESC, rule_id DESC LIMIT 1", [endDate]);
  return r.rows[0] || (await db.query("SELECT * FROM pay_rules ORDER BY effective_date LIMIT 1")).rows[0];
}

// USD to CAD rate to suggest: the one used in the latest payroll with USD pay, else FX_USD_TO_CAD
async function currentFx() {
  const r = await db.query(
    "SELECT pr.fx_rate FROM payroll pr JOIN pay_periods p ON p.period_id=pr.period_id WHERE pr.currency='USD' ORDER BY p.start_date DESC LIMIT 1");
  return r.rows[0] ? Number(r.rows[0].fx_rate) : config.defaultFx();
}

app.get("/api/payroll/:periodId", auth, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.params.periodId])).rows[0];
  if (!p) return res.status(404).json({ error: "Pay period not found." });
  const { rows } = await db.query(
    `SELECT pr.*, ROUND(pr.net_pay*pr.fx_rate,2) AS net_pay_cad, e.full_name, e.email, e.employment_type, e.pay_rate,
            cu.full_name AS computed_by_name, au.full_name AS approved_by_name
       FROM payroll pr JOIN employees e ON e.employee_id=pr.employee_id
       LEFT JOIN users cu ON cu.user_id=pr.computed_by LEFT JOIN users au ON au.user_id=pr.approved_by
      WHERE pr.period_id=$1 ORDER BY e.full_name`, [p.period_id]);
  const rule = rows[0] ? (await db.query("SELECT * FROM pay_rules WHERE rule_id=$1", [rows[0].rule_id])).rows[0] : await ruleFor(p.end_date);
  const usd = (await db.query("SELECT 1 FROM employees WHERE status='active' AND currency='USD' LIMIT 1")).rowCount > 0;
  res.json({ period: p, rule, items: rows, company: config.companyName(), fx_rate: await currentFx(), has_usd: usd,
    paypal: { configured: paypal.configured(), env: config.paypalEnv() } });
}));

app.post("/api/payroll/:periodId/compute", auth, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.params.periodId])).rows[0];
  if (!p) return res.status(404).json({ error: "Pay period not found." });
  if (p.status === "approved") return bad(res, "This payroll is already approved and locked.");
  const rule = await ruleFor(p.end_date);
  const fx = req.body?.fx_rate === undefined || req.body?.fx_rate === "" ? await currentFx() : Number(req.body.fx_rate);
  if (!(fx >= 0.5 && fx <= 5)) return bad(res, "Enter a valid USD to CAD exchange rate (for example 1.37).");
  // Get the latest hours first, so the payroll always uses what is in Clockify right now
  let sync = null;
  if ((await getApiKey()) || (await demoModeOn())) {
    try { sync = await syncPeriod(req.user.user_id, p); }
    catch (e) { if (e instanceof ClockifyError) return res.status(502).json({ error: "Could not get the hours from Clockify, so the payroll was not computed: " + e.message }); throw e; }
  }
  const emps = (await db.query("SELECT * FROM employees WHERE status='active' AND date_hired <= $1", [p.end_date])).rows;
  const client = await db.pool.connect();
  let count = 0;
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM payroll WHERE period_id=$1", [p.period_id]);
    for (const emp of emps) {
      const logs = (await client.query(
        "SELECT to_char(work_date,'YYYY-MM-DD') AS work_date, hours_worked FROM time_logs WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3",
        [emp.employee_id, p.start_date, p.end_date])).rows;
      if (!logs.length && emp.employment_type === "hourly") continue;
      const r = computePay(emp, logs, rule, fx);
      await client.query(
        `INSERT INTO payroll (employee_id, period_id, rule_id, computed_by, regular_hours, overtime_hours, gross_pay,
          cpp_deduction, ei_deduction, net_pay, currency, fx_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [emp.employee_id, p.period_id, rule.rule_id, req.user.user_id, r.regular_hours, r.overtime_hours, r.gross_pay,
          r.cpp_deduction, r.ei_deduction, r.net_pay, r.currency, r.fx_rate]);
      count++;
    }
    if (!count) {
      // Nothing to pay: leave the period open instead of letting an empty payroll be approved and locked
      await client.query("ROLLBACK");
      await db.query("UPDATE pay_periods SET status='open' WHERE period_id=$1 AND status='computed' AND NOT EXISTS (SELECT 1 FROM payroll WHERE period_id=$1)", [p.period_id]);
      const why = !sync
        ? "Clockify is not connected (set CLOCKIFY_API_KEY on the server), so no hours could be synced."
        : `${sync.synced} time entries were found in Clockify between ${p.start_date} and ${p.end_date}.` +
          (sync.unmatched?.length ? ` Clockify users not matched to any employee: ${sync.unmatched.join(", ")} — add them on the Employees page with the same email.` : "") +
          (sync.running ? ` ${sync.running} timer(s) are still running; stop them in Clockify first.` : "") +
          " Check that the hours are in this pay period.";
      return bad(res, "No employee has hours in this pay period, so there is nothing to compute. " + why);
    }
    await client.query("UPDATE pay_periods SET status='computed' WHERE period_id=$1", [p.period_id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
  await audit(req.user.user_id, "COMPUTE_PAYROLL", "payroll", p.period_id, null, { period: `${p.start_date} to ${p.end_date}`, employees: count, rule: rule.rule_name, usd_to_cad: fx });
  res.json({ ok: true, employees: count, sync });
}));

app.post("/api/payroll/:periodId/approve", auth, ownerOnly, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.params.periodId])).rows[0];
  if (!p) return res.status(404).json({ error: "Pay period not found." });
  if (p.status !== "computed") return bad(res, p.status === "approved" ? "Already approved." : "Compute the payroll first.");
  const n = (await db.query("SELECT COUNT(*)::int AS n FROM payroll WHERE period_id=$1", [p.period_id])).rows[0].n;
  if (!n) return bad(res, "There is no payroll to approve in this period. Sync the time logs and compute again.");
  await db.query("UPDATE payroll SET status='approved', approved_by=$1 WHERE period_id=$2", [req.user.user_id, p.period_id]);
  await db.query("UPDATE pay_periods SET status='approved' WHERE period_id=$1", [p.period_id]);
  const tot = (await db.query("SELECT COALESCE(SUM(ROUND(net_pay*fx_rate,2)),0) AS t FROM payroll WHERE period_id=$1", [p.period_id])).rows[0].t;
  await audit(req.user.user_id, "APPROVE_PAYROLL", "payroll", p.period_id, "computed", { status: "approved", total_net_cad: tot });
  res.json({ ok: true });
}));

// ---------- PayPal payouts ----------
// Updates the payout status of every unfinished PayPal item in a pay period
async function refreshPayouts(periodId) {
  const batches = (await db.query(
    `SELECT DISTINCT paypal_batch_id FROM payroll WHERE period_id=$1 AND paypal_batch_id IS NOT NULL
        AND (payout_status IS NULL OR NOT (payout_status = ANY($2)))`, [periodId, paypal.FINAL])).rows.map((r) => r.paypal_batch_id);
  let updated = 0;
  for (const b of batches) {
    const items = await paypal.payoutItems(b);
    for (const [payrollId, it] of Object.entries(items)) {
      const r = await db.query(
        `UPDATE payroll SET paypal_item_id=$1, payout_status=$2, payout_error=$3 WHERE payroll_id=$4 AND period_id=$5 AND paypal_batch_id=$6
           AND (payout_status IS DISTINCT FROM $2 OR paypal_item_id IS DISTINCT FROM $1)`,
        [it.item_id, it.status, it.error, payrollId, periodId, b]);
      updated += r.rowCount;
    }
  }
  return updated;
}

// Sends the approved net pay of everyone not paid yet (or whose last payout failed) to their email through PayPal
app.post("/api/payroll/:periodId/paypal", auth, ownerOnly, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.params.periodId])).rows[0];
  if (!p) return res.status(404).json({ error: "Pay period not found." });
  if (p.status !== "approved") return bad(res, "Approve the payroll before paying it.");
  if (!paypal.configured()) return bad(res, "PayPal is not connected. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server.");
  // Claim the rows first, so a double click cannot pay anyone twice
  const rows = (await db.query(
    `UPDATE payroll pr SET payout_status='SENDING', payout_error=NULL, paypal_batch_id=NULL, paypal_item_id=NULL
       FROM employees e
      WHERE e.employee_id=pr.employee_id AND pr.period_id=$1 AND pr.net_pay > 0
        AND (pr.payout_status IS NULL OR pr.payout_status = ANY($2))
      RETURNING pr.payroll_id, pr.net_pay, pr.currency, e.full_name, e.email`, [p.period_id, paypal.RETRYABLE])).rows;
  if (!rows.length) return bad(res, "Everyone in this payroll has already been sent their pay.");
  const ids = rows.map((r) => r.payroll_id);
  let batchId;
  try { batchId = await paypal.createPayout(p, rows, config.companyName()); }
  catch (e) {
    await db.query("UPDATE payroll SET payout_status=NULL, payout_error=$1 WHERE payroll_id = ANY($2)", [e.message, ids]);
    if (e instanceof paypal.PayPalError) return res.status(502).json({ error: "Payment not sent: " + e.message });
    throw e;
  }
  await db.query("UPDATE payroll SET paypal_batch_id=$1, payout_status='PENDING', paid_at=NOW() WHERE payroll_id = ANY($2)", [batchId, ids]);
  try { await refreshPayouts(p.period_id); } catch { /* the status can be refreshed later */ }
  const totals = {};
  for (const r of rows) totals[r.currency] = Math.round(((totals[r.currency] || 0) + Number(r.net_pay)) * 100) / 100;
  await audit(req.user.user_id, "PAYPAL_PAYOUT", "payroll", p.period_id, null,
    { period: `${p.start_date} to ${p.end_date}`, employees: rows.length, totals, batch_id: batchId, env: config.paypalEnv() });
  res.json({ ok: true, sent: rows.length, totals, batch_id: batchId, env: config.paypalEnv() });
}));

app.post("/api/payroll/:periodId/paypal/refresh", auth, wrap(async (req, res) => {
  if (!paypal.configured()) return bad(res, "PayPal is not connected.");
  const id = Number(req.params.periodId);
  if (!Number.isInteger(id)) return res.status(404).json({ error: "Pay period not found." });
  try { res.json({ ok: true, updated: await refreshPayouts(id) }); }
  catch (e) { if (e instanceof paypal.PayPalError) return res.status(502).json({ error: "Could not get the payout status: " + e.message }); throw e; }
}));

// ---------- dashboard ----------
app.get("/api/dashboard", auth, wrap(async (req, res) => {
  await ensurePayPeriods();
  const today = new Date().toISOString().slice(0, 10);
  const cur = (await db.query("SELECT * FROM pay_periods WHERE start_date <= $1 AND end_date >= $1", [today])).rows[0]
    || (await db.query("SELECT * FROM pay_periods ORDER BY start_date DESC LIMIT 1")).rows[0];
  const rule = await ruleFor(cur.end_date);
  const emps = (await db.query("SELECT * FROM employees WHERE status='active'")).rows;
  const fx = await currentFx();
  const perEmp = [];
  let totalHours = 0, otHours = 0, projected = 0;
  for (const emp of emps) {
    const logs = (await db.query(
      "SELECT to_char(work_date,'YYYY-MM-DD') AS work_date, hours_worked FROM time_logs WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3",
      [emp.employee_id, cur.start_date, cur.end_date])).rows;
    if (!logs.length && emp.employment_type === "hourly") { perEmp.push({ name: emp.full_name, hours: 0, cost_cad: 0 }); continue; }
    const r = computePay(emp, logs, rule, fx);
    const grossCad = r.gross_pay * r.fx_rate;
    totalHours += r.regular_hours + r.overtime_hours; otHours += r.overtime_hours; projected += grossCad;
    perEmp.push({ name: emp.full_name, hours: r.regular_hours + r.overtime_hours, overtime: r.overtime_hours, cost_cad: Math.round(grossCad * 100) / 100 });
  }
  const history = (await db.query(
    `SELECT p.period_id, p.start_date, p.end_date, p.status, COALESCE(SUM(pr.gross_pay*pr.fx_rate),0) AS gross_cad
       FROM pay_periods p LEFT JOIN payroll pr ON pr.period_id=p.period_id
      WHERE p.start_date <= $1 GROUP BY p.period_id ORDER BY p.start_date DESC LIMIT 8`, [today])).rows.reverse();
  const pending = (await db.query("SELECT COUNT(*)::int AS n FROM pay_periods WHERE status='computed'")).rows[0].n;
  res.json({
    period: cur, rule, fx_rate: fx,
    totals: { employees: emps.length, hours: Math.round(totalHours * 100) / 100, overtime: Math.round(otHours * 100) / 100, projected_cad: Math.round(projected * 100) / 100, pending_approval: pending },
    per_employee: perEmp.sort((a, b) => b.hours - a.hours), history,
    storefront_url: config.storefrontUrl(), company_name: config.companyName(),
    last_sync: await lastSync(),
  });
}));

// ---------- reports ----------
app.get("/api/reports", auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, u.full_name AS generated_by_name, p.start_date, p.end_date
       FROM payroll_reports r LEFT JOIN users u ON u.user_id=r.generated_by JOIN pay_periods p ON p.period_id=r.period_id
      ORDER BY r.generated_at DESC LIMIT 100`);
  res.json(rows);
}));

app.post("/api/reports", auth, wrap(async (req, res) => {
  const { period_id, report_type, file_format, file_path } = req.body || {};
  if (!period_id || !report_type || !["PDF", "Excel"].includes(file_format)) return bad(res, "Missing report details.");
  const { rows } = await db.query(
    "INSERT INTO payroll_reports (period_id, generated_by, report_type, file_format, file_path) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [period_id, req.user.user_id, report_type, file_format, String(file_path || "report").slice(0, 255)]);
  await audit(req.user.user_id, "GENERATE_REPORT", "payroll_reports", rows[0].report_id, null, { report_type, file_format });
  res.status(201).json(rows[0]);
}));

// ---------- audit trail (owner) ----------
app.get("/api/audit", auth, ownerOnly, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.user_id=a.user_id ORDER BY a.logged_at DESC LIMIT 300`);
  res.json(rows);
}));

// ---------- settings (read-only: configured with environment variables) ----------
app.get("/api/settings", auth, ownerOnly, wrap(async (req, res) => {
  const key = await getApiKey();
  const sample = (await db.query(
    "SELECT (SELECT COUNT(*) FROM employees WHERE tracker_user_id LIKE 'demo-%')::int AS employees, (SELECT COUNT(*) FROM time_logs WHERE tracker_entry_id LIKE 'demo-%')::int AS logs")).rows[0];
  res.json({
    company_name: config.companyName(), storefront_url: config.storefrontUrl(), timezone: await getTimezone(),
    fx_rate: await currentFx(), demo_mode: await demoModeOn(), sample_data: sample,
    clockify_connected: !!key, clockify_key_hint: key ? "••••" + key.slice(-4) : "", google_sign_in: !!config.googleClientId(),
    paypal: paypal.configured() ? config.paypalEnv() : "",
  });
}));

// Test the Clockify connection and show how Clockify users match employees
app.post("/api/settings/clockify-test", auth, ownerOnly, wrap(async (req, res) => {
  const key = await getApiKey();
  if (!key) return bad(res, "Clockify is not connected. Set CLOCKIFY_API_KEY in the server's environment variables.");
  try { res.json(await testConnection(key)); }
  catch (e) { if (e instanceof ClockifyError) return res.status(502).json({ error: e.message }); throw e; }
}));

// Remove the starter sample data so the system can be used for real payroll
app.post("/api/settings/clear-sample-data", auth, ownerOnly, wrap(async (req, res) => {
  const client = await db.pool.connect();
  let out;
  try {
    await client.query("BEGIN");
    const ids = (await client.query("SELECT employee_id FROM employees WHERE tracker_user_id LIKE 'demo-%'")).rows.map((r) => r.employee_id);
    const pay = await client.query("DELETE FROM payroll WHERE employee_id = ANY($1)", [ids]);
    const logs = await client.query("DELETE FROM time_logs WHERE tracker_entry_id LIKE 'demo-%' OR employee_id = ANY($1)", [ids]);
    const emps = await client.query("DELETE FROM employees WHERE employee_id = ANY($1)", [ids]);
    // Pay periods left with no payroll go back to open, and their report history is cleared
    const empty = "SELECT period_id FROM pay_periods p WHERE NOT EXISTS (SELECT 1 FROM payroll pr WHERE pr.period_id=p.period_id)";
    await client.query(`DELETE FROM payroll_reports WHERE period_id IN (${empty})`);
    await client.query(`UPDATE pay_periods SET status='open' WHERE period_id IN (${empty})`);
    await client.query("COMMIT");
    out = { employees: emps.rowCount, time_logs: logs.rowCount, payroll: pay.rowCount };
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
  await audit(req.user.user_id, "CLEAR_SAMPLE_DATA", "employees", null, null, out);
  res.json(out);
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- front end ----------
const dist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});

const PORT = process.env.PORT || 3000;
migrate()
  .then(seedIfEmpty)
  .then(() => app.listen(PORT, () => {
    console.log(`IPTAS running on port ${PORT}`);
    setTimeout(scheduledSync, 10 * 1000); // also right after the server wakes up
    setInterval(scheduledSync, SYNC_EVERY_MS);
  }))
  .catch((e) => { console.error("Startup failed:", e); process.exit(1); });
