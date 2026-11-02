require("./env");
const path = require("path");
const fs = require("fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("./db");
const { migrate, seedIfEmpty, ensurePayPeriods } = require("./seed");
const { computePay } = require("./payroll");
const { verifyGoogleToken, GoogleAuthError } = require("./google");
const { syncTimeLogs, testConnection, getApiKey, getTimezone, isValidTimezone, demoModeOn, ClockifyError } = require("./timetracker");

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

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();

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

// Sign in with Google: only for accounts that already exist (added by the Owner or an Administrator)
app.post("/api/auth/google", loginLimiter, wrap(async (req, res) => {
  let g;
  try { g = await verifyGoogleToken(req.body?.credential, GOOGLE_CLIENT_ID); }
  catch (e) { if (e instanceof GoogleAuthError) return res.status(401).json({ error: e.message }); throw e; }
  let u = (await db.query("SELECT * FROM users WHERE google_sub=$1 OR lower(email)=$2 ORDER BY (google_sub=$1) DESC LIMIT 1", [g.sub, g.email])).rows[0];
  if (!u) return res.status(403).json({ error: `No IPTAS account uses ${g.email}. Ask the Business Owner or an Administrator to add you under User Accounts.` });
  const blocked = statusBlock(res, u); if (blocked) return;
  if (!u.google_sub) await db.query("UPDATE users SET google_sub=$1 WHERE user_id=$2", [g.sub, u.user_id]);
  await db.query("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE user_id=$1", [u.user_id]);
  await audit(u.user_id, "LOGIN", "users", u.user_id, null, "Google");
  res.json(signIn(u));
}));

app.post("/api/auth/login", loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return bad(res, "Email and password are required.");
  const { rows } = await db.query("SELECT * FROM users WHERE lower(email)=lower($1)", [email.trim()]);
  const u = rows[0];
  if (!u || u.status === "inactive") return res.status(401).json({ error: "Invalid email or password." });
  if (u.locked_until && new Date(u.locked_until) > new Date())
    return res.status(423).json({ error: "Account locked after too many failed attempts. Try again in 15 minutes." });
  if (!bcrypt.compareSync(password, u.password_hash)) {
    const attempts = u.failed_attempts + 1;
    const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await db.query("UPDATE users SET failed_attempts=$1, locked_until=$2 WHERE user_id=$3", [lock ? 0 : attempts, lock, u.user_id]);
    await audit(u.user_id, "LOGIN_FAILED", "users", u.user_id, null, lock ? "Account locked" : `Attempt ${attempts}`);
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const blocked = statusBlock(res, u); if (blocked) return;
  await db.query("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE user_id=$1", [u.user_id]);
  await audit(u.user_id, "LOGIN", "users", u.user_id, null, null);
  res.json(signIn(u));
}));

app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));

// ---------- users (owner) ----------
app.get("/api/users", auth, wrap(async (req, res) => {
  const { rows } = await db.query(
    "SELECT user_id, full_name, email, role, status, created_at, (google_sub IS NOT NULL) AS google FROM users ORDER BY user_id");
  res.json(rows);
}));

app.post("/api/users", auth, wrap(async (req, res) => {
  const { full_name, email, password, role } = req.body || {};
  if (!full_name || !email || !password) return bad(res, "Name, email and password are required.");
  if (!["owner", "admin"].includes(role)) return bad(res, "Role must be owner or admin.");
  if (role === "owner" && req.user.role !== "owner") return res.status(403).json({ error: "Only the Business Owner can create another Business Owner account." });
  if (password.length < 8) return bad(res, "Password must be at least 8 characters.");
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
  await db.query("UPDATE users SET role=$1, status=$2 WHERE user_id=$3", [role, status, id]);
  if (password) {
    if (password.length < 8) return bad(res, "Password must be at least 8 characters.");
    await db.query("UPDATE users SET password_hash=$1, failed_attempts=0, locked_until=NULL WHERE user_id=$2", [bcrypt.hashSync(password, 10), id]);
  }
  await audit(req.user.user_id, "UPDATE_USER", "users", id,
    { role: old.role, status: old.status }, { role, status, password_reset: !!password });
  res.json({ ok: true });
}));


// ---------- employees ----------
const EMP_FIELDS = ["tracker_user_id", "full_name", "email", "employment_type", "pay_rate", "currency", "overtime_eligible", "apply_deductions", "status", "date_hired"];

function validateEmployee(b) {
  if (!b.full_name || !b.email) return "Full name and email are required.";
  if (!/^\S+@\S+\.\S+$/.test(b.email)) return "Please enter a valid email address.";
  if (!["hourly", "fixed"].includes(b.employment_type)) return "Employment type must be hourly or fixed.";
  if (!(Number(b.pay_rate) >= 0)) return "Pay rate must be a positive number.";
  if (!["CAD", "USD"].includes(b.currency)) return "Currency must be CAD or USD.";
  return null;
}

app.get("/api/employees", auth, wrap(async (req, res) => {
  const { rows } = await db.query("SELECT * FROM employees ORDER BY status, full_name");
  res.json(rows);
}));

app.post("/api/employees", auth, wrap(async (req, res) => {
  const b = { overtime_eligible: true, apply_deductions: true, status: "active", ...req.body };
  const err = validateEmployee(b); if (err) return bad(res, err);
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
  const err = validateEmployee(b); if (err) return bad(res, err);
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
    `SELECT p.*, COALESCE(SUM(pr.net_pay_cad),0) AS total_net_cad, COUNT(pr.payroll_id)::int AS employees
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
    `SELECT t.*, e.full_name FROM time_logs t JOIN employees e ON e.employee_id=t.employee_id
      WHERE ${where} ORDER BY t.work_date DESC, e.full_name`, params);
  const last = await db.query("SELECT value FROM settings WHERE key='last_sync'");
  res.json({
    period: p, logs: rows, last_sync: last.rows[0]?.value ? JSON.parse(last.rows[0].value) : null,
    timezone: await getTimezone(), clockify_connected: !!(await getApiKey()), demo_mode: await demoModeOn(),
  });
}));

// When hours change after payroll was computed, that payroll is out of date: clear it so it must be recomputed
async function invalidatePayroll(periodId) {
  const r = await db.query("UPDATE pay_periods SET status='open' WHERE period_id=$1 AND status='computed' RETURNING period_id", [periodId]);
  if (r.rowCount) await db.query("DELETE FROM payroll WHERE period_id=$1", [periodId]);
  return r.rowCount > 0;
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z"));

// Manual entry: for corrections or hours not tracked in Clockify
app.post("/api/timelogs", auth, wrap(async (req, res) => {
  const { employee_id, work_date, hours_worked, project } = req.body || {};
  const hours = Number(hours_worked);
  if (!employee_id) return bad(res, "Select an employee.");
  if (!isDate(work_date)) return bad(res, "Enter a valid date.");
  if (!(hours > 0 && hours <= 24)) return bad(res, "Hours must be more than 0 and at most 24.");
  const emp = (await db.query("SELECT employee_id, full_name FROM employees WHERE employee_id=$1", [employee_id])).rows[0];
  if (!emp) return bad(res, "Employee not found.");
  const p = (await db.query("SELECT * FROM pay_periods WHERE $1 BETWEEN start_date AND end_date", [work_date])).rows[0];
  if (!p) return bad(res, "That date is not inside any pay period.");
  if (p.status === "approved") return bad(res, "That pay period is already approved and locked.");
  const { rows } = await db.query(
    `INSERT INTO time_logs (employee_id, tracker_entry_id, work_date, hours_worked, project, source)
     VALUES ($1, 'manual-' || md5(random()::text || clock_timestamp()::text), $2, $3, $4, 'manual') RETURNING *`,
    [emp.employee_id, work_date, Math.round(hours * 100) / 100, (project || "").trim().slice(0, 100) || null]);
  const reset = await invalidatePayroll(p.period_id);
  await audit(req.user.user_id, "ADD_TIME_ENTRY", "time_logs", rows[0].log_id, null,
    { employee: emp.full_name, work_date, hours: rows[0].hours_worked, note: rows[0].project });
  res.status(201).json({ ...rows[0], payroll_reset: reset });
}));

app.delete("/api/timelogs/:id", auth, wrap(async (req, res) => {
  const l = (await db.query(
    `SELECT t.*, e.full_name, p.period_id, p.status AS period_status FROM time_logs t JOIN employees e ON e.employee_id=t.employee_id
       LEFT JOIN pay_periods p ON t.work_date BETWEEN p.start_date AND p.end_date WHERE t.log_id=$1`, [req.params.id])).rows[0];
  if (!l) return res.status(404).json({ error: "Time entry not found." });
  if (l.source !== "manual") return bad(res, "Only manual entries can be deleted here. Change Clockify entries in Clockify, then sync again.");
  if (l.period_status === "approved") return bad(res, "That pay period is already approved and locked.");
  await db.query("DELETE FROM time_logs WHERE log_id=$1", [l.log_id]);
  const reset = l.period_id ? await invalidatePayroll(l.period_id) : false;
  await audit(req.user.user_id, "DELETE_TIME_ENTRY", "time_logs", l.log_id,
    { employee: l.full_name, work_date: l.work_date, hours: l.hours_worked, note: l.project }, null);
  res.json({ ok: true, payroll_reset: reset });
}));

app.post("/api/timelogs/sync", auth, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.body?.period_id])).rows[0];
  if (!p) return bad(res, "Select a pay period.");
  if (p.status === "approved") return bad(res, "This pay period is already approved and locked.");
  let result;
  try {
    result = await syncTimeLogs(p.start_date, p.end_date);
  } catch (e) {
    if (!(e instanceof ClockifyError)) throw e;
    await audit(req.user.user_id, "SYNC_FAILED", "time_logs", p.period_id, null, e.message);
    return res.status(502).json({ error: "Time-log sync failed: " + e.message });
  }
  const payroll_reset = await invalidatePayroll(p.period_id);
  const info = { ...result, payroll_reset, at: new Date().toISOString(), period: `${p.start_date} to ${p.end_date}` };
  await db.query("INSERT INTO settings (key,value) VALUES ('last_sync',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify(info)]);
  await audit(req.user.user_id, "SYNC_TIME_LOGS", "time_logs", p.period_id, null, info);
  res.json(info);
}));

// ---------- pay rules ----------
app.get("/api/rules", auth, wrap(async (req, res) => {
  const { rows } = await db.query("SELECT * FROM pay_rules ORDER BY effective_date DESC, rule_id DESC");
  res.json(rows);
}));

app.post("/api/rules", auth, ownerOnly, wrap(async (req, res) => {
  const b = req.body || {};
  const nums = ["overtime_threshold", "overtime_multiplier", "cpp_rate", "ei_rate", "fx_usd_to_cad"];
  for (const n of nums) if (!(Number(b[n]) >= 0)) return bad(res, `Please enter a valid value for ${n.replace(/_/g, " ")}.`);
  if (Number(b.overtime_threshold) <= 0 || Number(b.overtime_multiplier) < 1) return bad(res, "Overtime threshold must be above 0 and multiplier at least 1.");
  if (Number(b.cpp_rate) > 0.2 || Number(b.ei_rate) > 0.2) return bad(res, "Enter CPP and EI rates as decimals (e.g. 0.0595 for 5.95%).");
  const { rows } = await db.query(
    `INSERT INTO pay_rules (rule_name, overtime_threshold, overtime_multiplier, cpp_rate, ei_rate, fx_usd_to_cad, effective_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.rule_name || "Updated rules", ...nums.map((n) => b[n]), b.effective_date || new Date().toISOString().slice(0, 10)]);
  await audit(req.user.user_id, "UPDATE_PAY_RULES", "pay_rules", rows[0].rule_id, null, rows[0]);
  res.status(201).json(rows[0]);
}));

// ---------- payroll ----------
async function ruleFor(endDate) {
  const r = await db.query("SELECT * FROM pay_rules WHERE effective_date <= $1 ORDER BY effective_date DESC, rule_id DESC LIMIT 1", [endDate]);
  return r.rows[0] || (await db.query("SELECT * FROM pay_rules ORDER BY effective_date LIMIT 1")).rows[0];
}

app.get("/api/payroll/:periodId", auth, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.params.periodId])).rows[0];
  if (!p) return res.status(404).json({ error: "Pay period not found." });
  const { rows } = await db.query(
    `SELECT pr.*, e.full_name, e.email, e.employment_type, e.pay_rate,
            cu.full_name AS computed_by_name, au.full_name AS approved_by_name
       FROM payroll pr JOIN employees e ON e.employee_id=pr.employee_id
       LEFT JOIN users cu ON cu.user_id=pr.computed_by LEFT JOIN users au ON au.user_id=pr.approved_by
      WHERE pr.period_id=$1 ORDER BY e.full_name`, [p.period_id]);
  const rule = rows[0] ? (await db.query("SELECT * FROM pay_rules WHERE rule_id=$1", [rows[0].rule_id])).rows[0] : await ruleFor(p.end_date);
  const company = (await db.query("SELECT value FROM settings WHERE key='company_name'")).rows[0]?.value || "";
  res.json({ period: p, rule, items: rows, company });
}));

app.post("/api/payroll/:periodId/compute", auth, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.params.periodId])).rows[0];
  if (!p) return res.status(404).json({ error: "Pay period not found." });
  if (p.status === "approved") return bad(res, "This payroll is already approved and locked.");
  const rule = await ruleFor(p.end_date);
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
      const r = computePay(emp, logs, rule);
      await client.query(
        `INSERT INTO payroll (employee_id, period_id, rule_id, computed_by, regular_hours, overtime_hours, gross_pay,
          cpp_deduction, ei_deduction, net_pay, currency, fx_rate, net_pay_cad)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [emp.employee_id, p.period_id, rule.rule_id, req.user.user_id, r.regular_hours, r.overtime_hours, r.gross_pay,
          r.cpp_deduction, r.ei_deduction, r.net_pay, r.currency, r.fx_rate, r.net_pay_cad]);
      count++;
    }
    if (!count) {
      // Nothing to pay: leave the period open instead of letting an empty payroll be approved and locked
      await client.query("ROLLBACK");
      await db.query("UPDATE pay_periods SET status='open' WHERE period_id=$1 AND status='computed' AND NOT EXISTS (SELECT 1 FROM payroll WHERE period_id=$1)", [p.period_id]);
      return bad(res, "No employee has hours in this pay period, so there is nothing to compute. Sync the time logs (or add entries) for this period first, and check that your employees are matched to Clockify users in Settings.");
    }
    await client.query("UPDATE pay_periods SET status='computed' WHERE period_id=$1", [p.period_id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
  await audit(req.user.user_id, "COMPUTE_PAYROLL", "payroll", p.period_id, null, { period: `${p.start_date} to ${p.end_date}`, employees: count, rule: rule.rule_name });
  res.json({ ok: true, employees: count });
}));

app.post("/api/payroll/:periodId/approve", auth, ownerOnly, wrap(async (req, res) => {
  const p = (await db.query("SELECT * FROM pay_periods WHERE period_id=$1", [req.params.periodId])).rows[0];
  if (!p) return res.status(404).json({ error: "Pay period not found." });
  if (p.status !== "computed") return bad(res, p.status === "approved" ? "Already approved." : "Compute the payroll first.");
  const n = (await db.query("SELECT COUNT(*)::int AS n FROM payroll WHERE period_id=$1", [p.period_id])).rows[0].n;
  if (!n) return bad(res, "There is no payroll to approve in this period. Sync the time logs and compute again.");
  await db.query("UPDATE payroll SET status='approved', approved_by=$1, approved_at=NOW() WHERE period_id=$2", [req.user.user_id, p.period_id]);
  await db.query("UPDATE pay_periods SET status='approved' WHERE period_id=$1", [p.period_id]);
  const tot = (await db.query("SELECT COALESCE(SUM(net_pay_cad),0) AS t FROM payroll WHERE period_id=$1", [p.period_id])).rows[0].t;
  await audit(req.user.user_id, "APPROVE_PAYROLL", "payroll", p.period_id, "computed", { status: "approved", total_net_cad: tot });
  res.json({ ok: true });
}));

// ---------- dashboard ----------
app.get("/api/dashboard", auth, wrap(async (req, res) => {
  await ensurePayPeriods();
  const today = new Date().toISOString().slice(0, 10);
  const cur = (await db.query("SELECT * FROM pay_periods WHERE start_date <= $1 AND end_date >= $1", [today])).rows[0]
    || (await db.query("SELECT * FROM pay_periods ORDER BY start_date DESC LIMIT 1")).rows[0];
  const rule = await ruleFor(cur.end_date);
  const emps = (await db.query("SELECT * FROM employees WHERE status='active'")).rows;
  const perEmp = [];
  let totalHours = 0, otHours = 0, projected = 0;
  for (const emp of emps) {
    const logs = (await db.query(
      "SELECT to_char(work_date,'YYYY-MM-DD') AS work_date, hours_worked FROM time_logs WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3",
      [emp.employee_id, cur.start_date, cur.end_date])).rows;
    if (!logs.length && emp.employment_type === "hourly") { perEmp.push({ name: emp.full_name, hours: 0, cost_cad: 0 }); continue; }
    const r = computePay(emp, logs, rule);
    const grossCad = r.gross_pay * r.fx_rate;
    totalHours += r.regular_hours + r.overtime_hours; otHours += r.overtime_hours; projected += grossCad;
    perEmp.push({ name: emp.full_name, hours: r.regular_hours + r.overtime_hours, overtime: r.overtime_hours, cost_cad: Math.round(grossCad * 100) / 100 });
  }
  const history = (await db.query(
    `SELECT p.period_id, p.start_date, p.end_date, p.status, COALESCE(SUM(pr.gross_pay*pr.fx_rate),0) AS gross_cad
       FROM pay_periods p LEFT JOIN payroll pr ON pr.period_id=p.period_id
      WHERE p.start_date <= $1 GROUP BY p.period_id ORDER BY p.start_date DESC LIMIT 8`, [today])).rows.reverse();
  const pending = (await db.query("SELECT COUNT(*)::int AS n FROM pay_periods WHERE status='computed'")).rows[0].n;
  const settings = Object.fromEntries((await db.query("SELECT key,value FROM settings WHERE key IN ('storefront_url','company_name','last_sync')")).rows.map((r) => [r.key, r.value]));
  res.json({
    period: cur, rule,
    totals: { employees: emps.length, hours: Math.round(totalHours * 100) / 100, overtime: Math.round(otHours * 100) / 100, projected_cad: Math.round(projected * 100) / 100, pending_approval: pending },
    per_employee: perEmp.sort((a, b) => b.hours - a.hours), history,
    storefront_url: settings.storefront_url, company_name: settings.company_name,
    last_sync: settings.last_sync ? JSON.parse(settings.last_sync) : null,
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
  const { period_id, report_type, file_format, file_name } = req.body || {};
  if (!period_id || !report_type || !["PDF", "Excel"].includes(file_format)) return bad(res, "Missing report details.");
  const { rows } = await db.query(
    "INSERT INTO payroll_reports (period_id, generated_by, report_type, file_format, file_name) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [period_id, req.user.user_id, report_type, file_format, file_name || "report"]);
  await audit(req.user.user_id, "GENERATE_REPORT", "payroll_reports", rows[0].report_id, null, { report_type, file_format });
  res.status(201).json(rows[0]);
}));

// ---------- audit trail (owner) ----------
app.get("/api/audit", auth, ownerOnly, wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.user_id=a.user_id ORDER BY a.logged_at DESC LIMIT 300`);
  res.json(rows);
}));

// ---------- settings ----------
const setSetting = (k, v) => db.query("INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2", [k, v]);

app.get("/api/settings", auth, wrap(async (req, res) => {
  const s = Object.fromEntries((await db.query(
    "SELECT key,value FROM settings WHERE key IN ('company_name','storefront_url','clockify_workspace_id')")).rows.map((r) => [r.key, r.value]));
  const key = await getApiKey();
  const sample = (await db.query(
    "SELECT (SELECT COUNT(*) FROM employees WHERE tracker_user_id LIKE 'demo-%')::int AS employees, (SELECT COUNT(*) FROM time_logs WHERE source='demo')::int AS logs")).rows[0];
  res.json({
    ...s, timezone: await getTimezone(), demo_mode: await demoModeOn(), sample_data: sample,
    clockify_connected: !!key, clockify_from_env: !!process.env.CLOCKIFY_API_KEY, clockify_key_hint: key ? "••••" + key.slice(-4) : "",
  });
}));

app.put("/api/settings", auth, ownerOnly, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.storefront_url && !/^https?:\/\/\S+$/i.test(String(b.storefront_url).trim())) return bad(res, "The storefront URL must start with http:// or https://");
  if (b.timezone !== undefined && !isValidTimezone(b.timezone)) return bad(res, "Unknown time zone.");
  const note = {};
  if (b.clockify_api_key !== undefined) {
    const key = String(b.clockify_api_key).trim();
    if (key) {
      // Check the key works before saving it
      try { const t = await testConnection(key); note.clockify = `connected to ${t.workspace.name}`; }
      catch (e) { if (e instanceof ClockifyError) return bad(res, "Key not saved: " + e.message); throw e; }
    }
    await setSetting("clockify_api_key", key);
    if (!key) await db.query("DELETE FROM settings WHERE key='clockify_workspace_id'");
  }
  for (const k of ["company_name", "storefront_url", "timezone", "clockify_workspace_id"]) {
    if (b[k] !== undefined) await setSetting(k, String(b[k]).trim());
  }
  await audit(req.user.user_id, "UPDATE_SETTINGS", "settings", null, null,
    { ...b, ...note, clockify_api_key: b.clockify_api_key === undefined ? undefined : b.clockify_api_key ? "(updated)" : "(removed)" });
  res.json({ ok: true });
}));

// Test the Clockify connection and show how Clockify users match employees
app.post("/api/settings/clockify-test", auth, ownerOnly, wrap(async (req, res) => {
  const key = String(req.body?.key || "").trim() || (await getApiKey());
  if (!key) return bad(res, "Enter a Clockify API key first.");
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
    const logs = await client.query("DELETE FROM time_logs WHERE source='demo' OR employee_id = ANY($1)", [ids]);
    const emps = await client.query("DELETE FROM employees WHERE employee_id = ANY($1)", [ids]);
    // Pay periods left with no payroll go back to open, and their report history is cleared
    const empty = "SELECT period_id FROM pay_periods p WHERE NOT EXISTS (SELECT 1 FROM payroll pr WHERE pr.period_id=p.period_id)";
    await client.query(`DELETE FROM payroll_reports WHERE period_id IN (${empty})`);
    await client.query(`UPDATE pay_periods SET status='open' WHERE period_id IN (${empty})`);
    await client.query("DELETE FROM settings WHERE key='last_sync'");
    await client.query("INSERT INTO settings (key,value) VALUES ('demo_mode','off') ON CONFLICT (key) DO UPDATE SET value='off'");
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
  .then(() => app.listen(PORT, () => console.log(`IPTAS running on port ${PORT}`)))
  .catch((e) => { console.error("Startup failed:", e); process.exit(1); });
