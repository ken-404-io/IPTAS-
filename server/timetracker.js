// Time Tracker API Integration (Module 1): Clockify REST API, with a demo mode for sample data.
const db = require("./db");

// Regional Clockify workspaces use a different address, e.g. https://euc1.clockify.me/api/v1
const clockifyBase = () => (process.env.CLOCKIFY_API_URL || "https://api.clockify.me/api/v1").replace(/\/+$/, "");
const PAGE_SIZE = 200;
const DEFAULT_TZ = "America/Toronto";

async function getSetting(key) {
  const r = await db.query("SELECT value FROM settings WHERE key=$1", [key]);
  return r.rows[0]?.value ?? null;
}

async function getApiKey() {
  if (process.env.CLOCKIFY_API_KEY) return process.env.CLOCKIFY_API_KEY;
  return (await getSetting("clockify_api_key")) || "";
}

async function getTimezone() {
  const tz = (await getSetting("timezone")) || DEFAULT_TZ;
  return isValidTimezone(tz) ? tz : DEFAULT_TZ;
}

function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
}

// Demo mode is on for the starter data and turns off once the owner removes the sample data.
async function demoModeOn() {
  return (await getSetting("demo_mode")) !== "off";
}

class ClockifyError extends Error {}

async function clockifyGet(path, key, attempt = 1) {
  let res;
  try {
    res = await fetch(clockifyBase() + path, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new ClockifyError(`could not connect to Clockify (${e.name === "TimeoutError" ? "timed out" : e.message}).`);
  }
  if (res.status === 429 && attempt < 4) { // rate limited: wait and retry
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return clockifyGet(path, key, attempt + 1);
  }
  if (res.status === 401) throw new ClockifyError("Clockify rejected the API key. Check the key in Settings.");
  if (!res.ok) {
    const err = new ClockifyError(`Clockify API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Fetch every page of a list endpoint
async function clockifyGetAll(path, key) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const rows = await clockifyGet(`${path}${sep}page=${page}&page-size=${PAGE_SIZE}`, key);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

// Calendar date (YYYY-MM-DD) of an instant in the business time zone
function localDate(iso, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// Parse ISO-8601 duration like PT7H30M15S (or P1DT2H) into hours
function durationHours(iso) {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  return Number(m[1] || 0) * 24 + Number(m[2] || 0) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600;
}

function entryHours(interval) {
  if (interval.start && interval.end) {
    const ms = new Date(interval.end) - new Date(interval.start);
    if (ms >= 0) return ms / 3600000;
  }
  return durationHours(interval.duration);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function upsertLog(employeeId, entryId, workDate, start, end, hours, project, source) {
  await db.query(
    `INSERT INTO time_logs (employee_id, tracker_entry_id, work_date, start_time, end_time, hours_worked, project, source, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (tracker_entry_id) DO UPDATE SET
       employee_id=EXCLUDED.employee_id, work_date=EXCLUDED.work_date, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time,
       hours_worked=EXCLUDED.hours_worked, project=EXCLUDED.project, synced_at=NOW()`,
    [employeeId, entryId, workDate, start, end, Math.round(hours * 100) / 100, project, source]
  );
}

// Workspace to use: the one chosen in Settings, otherwise the key owner's active workspace
async function pickWorkspace(key) {
  const me = await clockifyGet("/user", key);
  const workspaces = await clockifyGet("/workspaces", key).catch(() => []);
  const saved = await getSetting("clockify_workspace_id");
  const ws = (saved && workspaces.some((w) => w.id === saved) ? saved : null) || me.activeWorkspace || me.defaultWorkspace;
  if (!ws) throw new ClockifyError("This Clockify account has no workspace.");
  return { me, ws, workspaces };
}

// Clockify's own demo people ("[SAMPLE] Amy Smith", ...@clockify-test.com) are not real workers
const isClockifySample = (u) => /@clockify-test\.com$/i.test(u.email || "") || /^\[SAMPLE\]/i.test(u.name || "");

// Workspace members. Listing them needs a workspace admin key; otherwise only the key owner is synced.
async function workspaceUsers(key, ws, me) {
  try {
    const users = await clockifyGetAll(`/workspaces/${ws}/users`, key);
    return { users: users.filter((u) => !isClockifySample(u)), adminAccess: true };
  } catch (e) {
    if (e.status === 403) return { users: [{ id: me.id, email: me.email, name: me.name }], adminAccess: false };
    throw e;
  }
}

async function activeEmployees() {
  return (await db.query("SELECT employee_id, full_name, tracker_user_id, lower(email) AS email FROM employees WHERE status='active'")).rows;
}

const matchEmployee = (emps, u) =>
  emps.find((e) => e.tracker_user_id === u.id) || emps.find((e) => e.email && e.email === (u.email || "").toLowerCase());

// Checks a key and shows which Clockify users match which employees (used by Settings)
async function testConnection(key) {
  const { me, ws, workspaces } = await pickWorkspace(key);
  const { users, adminAccess } = await workspaceUsers(key, ws, me);
  const emps = await activeEmployees();
  return {
    account: { name: me.name, email: me.email },
    workspace: { id: ws, name: workspaces.find((w) => w.id === ws)?.name || ws },
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
    admin_access: adminAccess,
    users: users.map((u) => {
      const e = matchEmployee(emps, u);
      return { id: u.id, name: u.name, email: u.email, status: u.status, employee: e ? e.full_name : null };
    }),
  };
}

async function syncClockify(key, startDate, endDate) {
  const tz = await getTimezone();
  const { me, ws } = await pickWorkspace(key);
  const { users, adminAccess } = await workspaceUsers(key, ws, me);
  const projects = await clockifyGetAll(`/workspaces/${ws}/projects`, key).catch(() => []);
  const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const emps = await activeEmployees();

  // Ask for one extra day on each side, then keep entries whose local date is inside the period
  const from = new Date(addDays(startDate, -1) + "T00:00:00Z").toISOString();
  const to = new Date(addDays(endDate, 1) + "T23:59:59Z").toISOString();

  let synced = 0, linked = 0, removed = 0, running = 0;
  const unmatched = [];
  for (const u of users) {
    const emp = matchEmployee(emps, u);
    if (!emp) { unmatched.push(u.email || u.name); continue; }
    if (emp.tracker_user_id !== u.id) {
      await db.query("UPDATE employees SET tracker_user_id=$1 WHERE employee_id=$2", [u.id, emp.employee_id]);
      emp.tracker_user_id = u.id;
      linked++;
    }
    const entries = await clockifyGetAll(
      `/workspaces/${ws}/user/${u.id}/time-entries?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`, key);
    const kept = [];
    for (const e of entries) {
      const ti = e.timeInterval || {};
      if (!ti.start) continue;
      if (!ti.end) { running++; continue; } // timer still running: picked up by the next sync
      const day = localDate(ti.start, tz);
      if (day < startDate || day > endDate) continue;
      const id = "clockify-" + e.id;
      await upsertLog(emp.employee_id, id, day, ti.start, ti.end, entryHours(ti),
        projectName[e.projectId] || e.description || null, "clockify");
      kept.push(id);
      synced++;
    }
    // Entries deleted in Clockify (or moved out of this period) are removed here too
    const del = await db.query(
      `DELETE FROM time_logs WHERE employee_id=$1 AND source='clockify' AND work_date BETWEEN $2 AND $3 AND NOT (tracker_entry_id = ANY($4))`,
      [emp.employee_id, startDate, endDate, kept]);
    removed += del.rowCount;
  }
  // Real hours replace any sample hours in this period
  const demo = await db.query("DELETE FROM time_logs WHERE source='demo' AND work_date BETWEEN $1 AND $2", [startDate, endDate]);
  removed += demo.rowCount;
  return { mode: "clockify", synced, linked, removed, running, unmatched, admin_access: adminAccess, timezone: tz };
}

// Deterministic pseudo-random so demo data is stable
function seeded(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

const DEMO_PROJECTS = ["Order Fulfillment", "Customer Support", "Product Listings", "Marketing", "Inventory"];

async function syncDemo(startDate, endDate) {
  const emps = (await db.query("SELECT employee_id, tracker_user_id, date_hired FROM employees WHERE status='active'")).rows;
  const today = new Date().toISOString().slice(0, 10);
  let synced = 0;
  for (const e of emps) {
    const tid = e.tracker_user_id || "emp" + e.employee_id;
    for (let d = new Date(startDate + "T00:00:00Z"); d.toISOString().slice(0, 10) <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (ds > today) break;
      if (e.date_hired && ds < e.date_hired) continue;
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const r = seeded(tid + ds);
      if (r < 0.06) continue; // occasional day off
      const hours = 6.5 + Math.round(r * 6) / 2; // 6.5 - 9.5 h
      const startH = 13 + Math.floor(seeded(ds + tid) * 3); // 9-11 am Toronto time
      const st = new Date(`${ds}T${String(startH).padStart(2, "0")}:00:00Z`);
      const en = new Date(st.getTime() + hours * 3600000);
      await upsertLog(e.employee_id, `demo-${tid}-${ds}`, ds, st.toISOString(), en.toISOString(), hours,
        DEMO_PROJECTS[Math.floor(seeded(tid) * DEMO_PROJECTS.length)], "demo");
      synced++;
    }
  }
  return { mode: "demo", synced, linked: 0, removed: 0, running: 0, unmatched: [] };
}

async function syncTimeLogs(startDate, endDate) {
  const key = await getApiKey();
  if (key) return syncClockify(key, startDate, endDate);
  if (await demoModeOn()) return syncDemo(startDate, endDate);
  throw new ClockifyError("Clockify is not connected. The Business Owner can add the API key in Settings.");
}

module.exports = {
  syncTimeLogs, syncDemo, testConnection, durationHours, entryHours, localDate, getApiKey, getTimezone,
  isValidTimezone, demoModeOn, ClockifyError, DEFAULT_TZ,
};
