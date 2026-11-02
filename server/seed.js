require("./env");
// Creates tables and loads starter data the first time the app runs on an empty database.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { syncDemo } = require("./timetracker");
const { computePay } = require("./payroll");
const { config } = require("./config");

const ANCHOR = "2026-09-26"; // go-live date (first pay period start)

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Make sure pay periods exist up to the period that contains today (+1 upcoming)
async function ensurePayPeriods() {
  const today = new Date().toISOString().slice(0, 10);
  let start = ANCHOR;
  while (start <= addDays(today, 14)) {
    await db.query(
      `INSERT INTO pay_periods (start_date, end_date, pay_date) VALUES ($1,$2,$3) ON CONFLICT (start_date) DO NOTHING`,
      [start, addDays(start, 13), addDays(start, 19)]);
    start = addDays(start, 14);
  }
}

async function migrate() {
  await db.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
}

async function seedIfEmpty() {
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM users");
  if (rows[0].n > 0) { await ensurePayPeriods(); return false; }
  console.log("Empty database - loading starter data...");

  const owner = await db.query(
    `INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,'owner') RETURNING user_id`,
    ["Store Owner", "owner@iptas.app", bcrypt.hashSync("Owner@2026", 10)]);
  const admin = await db.query(
    `INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,'admin') RETURNING user_id`,
    ["Payroll Administrator", "admin@iptas.app", bcrypt.hashSync("Admin@2026", 10)]);
  const ownerId = owner.rows[0].user_id, adminId = admin.rows[0].user_id;

  await db.query(
    `INSERT INTO pay_rules (rule_name, overtime_threshold, overtime_multiplier, cpp_rate, ei_rate, effective_date)
     VALUES ('Standard 2026', 6, 1.5, 0.0595, 0.0164, '2026-01-01')`);

  const emps = [
    ["demo-u01", "Liam Tremblay", "liam.tremblay@example.com", "hourly", 22.5, "CAD", true, "2026-03-02"],
    ["demo-u02", "Olivia Martin", "olivia.martin@example.com", "hourly", 24.0, "CAD", true, "2026-01-12"],
    ["demo-u03", "Noah Roy", "noah.roy@example.com", "fixed", 1850, "CAD", false, "2025-11-03"],
    ["demo-u04", "Emma Gagnon", "emma.gagnon@example.com", "hourly", 19.75, "CAD", true, "2026-05-18"],
    ["demo-u05", "Maria Santos", "maria.santos@example.com", "hourly", 9.5, "USD", true, "2026-02-09"],
    ["demo-u06", "John Reyes", "john.reyes@example.com", "hourly", 8.75, "USD", true, "2026-04-06"],
    ["demo-u07", "Ana Cruz", "ana.cruz@example.com", "fixed", 900, "USD", false, "2025-12-01"],
    ["demo-u08", "William Bouchard", "william.bouchard@example.com", "hourly", 21.0, "CAD", true, "2026-06-22"],
  ];
  for (const e of emps) {
    await db.query(
      `INSERT INTO employees (tracker_user_id, full_name, email, employment_type, pay_rate, currency, overtime_eligible, date_hired)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, e);
  }

  await ensurePayPeriods();

  // Demo time logs and approved payroll history for closed periods (except the latest closed one)
  const today = new Date().toISOString().slice(0, 10);
  const periods = (await db.query("SELECT * FROM pay_periods ORDER BY start_date")).rows;
  const closed = periods.filter((p) => p.end_date < today);
  for (const p of periods) {
    const s = p.start_date, e = p.end_date;
    if (s <= today) await syncDemo(s, e);
  }
  const rule = (await db.query("SELECT * FROM pay_rules ORDER BY rule_id DESC LIMIT 1")).rows[0];
  const employees = (await db.query("SELECT * FROM employees")).rows;
  for (const p of closed.slice(0, -1)) {
    for (const emp of employees) {
      const logs = (await db.query(
        "SELECT to_char(work_date,'YYYY-MM-DD') AS work_date, hours_worked FROM time_logs WHERE employee_id=$1 AND work_date BETWEEN $2 AND $3",
        [emp.employee_id, p.start_date, p.end_date])).rows;
      if (!logs.length && emp.employment_type === "hourly") continue;
      const r = computePay(emp, logs, rule, config.defaultFx());
      await db.query(
        `INSERT INTO payroll (employee_id, period_id, rule_id, computed_by, approved_by, regular_hours, overtime_hours, gross_pay,
          cpp_deduction, ei_deduction, net_pay, currency, fx_rate, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'approved')`,
        [emp.employee_id, p.period_id, rule.rule_id, adminId, ownerId, r.regular_hours, r.overtime_hours, r.gross_pay,
          r.cpp_deduction, r.ei_deduction, r.net_pay, r.currency, r.fx_rate]);
    }
    await db.query("UPDATE pay_periods SET status='approved' WHERE period_id=$1", [p.period_id]);
  }
  // The last sync is read from the audit trail
  await db.query(`INSERT INTO audit_log (user_id, action, table_name, new_value) VALUES ($1,'SYNC_TIME_LOGS','time_logs',$2)`,
    [adminId, JSON.stringify({ mode: "demo", synced: (await db.query("SELECT COUNT(*)::int AS n FROM time_logs")).rows[0].n, linked: 0, unmatched: [], at: new Date().toISOString(), period: "initial load" })]);
  await db.query(`INSERT INTO audit_log (user_id, action, table_name, new_value) VALUES ($1,'SYSTEM_SETUP','users','Starter data loaded')`, [ownerId]);
  console.log("Starter data loaded. Owner: owner@iptas.app / Owner@2026  Admin: admin@iptas.app / Admin@2026");
  return true;
}

module.exports = { migrate, seedIfEmpty, ensurePayPeriods };

if (require.main === module) {
  migrate().then(seedIfEmpty).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
