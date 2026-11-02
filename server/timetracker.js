// Time Tracker API Integration (Module 1): Clockify REST API, with a demo mode fallback.
const db = require("./db");

const CLOCKIFY = "https://api.clockify.me/api/v1";

async function getApiKey() {
  if (process.env.CLOCKIFY_API_KEY) return process.env.CLOCKIFY_API_KEY;
  const r = await db.query("SELECT value FROM settings WHERE key='clockify_api_key'");
  return r.rows[0]?.value || "";
}

async function clockifyGet(path, key) {
  const res = await fetch(CLOCKIFY + path, { headers: { "X-Api-Key": key } });
  if (!res.ok) throw new Error(`Clockify API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Parse ISO-8601 duration like PT7H30M15S into hours
function durationHours(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) + Number(m[2] || 0) / 60 + Number(m[3] || 0) / 3600);
}

async function upsertLog(employeeId, entryId, workDate, start, end, hours, project, source) {
  await db.query(
    `INSERT INTO time_logs (employee_id, tracker_entry_id, work_date, start_time, end_time, hours_worked, project, source, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (tracker_entry_id) DO UPDATE SET
       work_date=EXCLUDED.work_date, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time,
       hours_worked=EXCLUDED.hours_worked, project=EXCLUDED.project, synced_at=NOW()`,
    [employeeId, entryId, workDate, start, end, Math.round(hours * 100) / 100, project, source]
  );
}

async function syncClockify(key, startDate, endDate) {
  const me = await clockifyGet("/user", key);
  const ws = me.activeWorkspace || me.defaultWorkspace;
  const users = await clockifyGet(`/workspaces/${ws}/users?page-size=200`, key);
  const projects = await clockifyGet(`/workspaces/${ws}/projects?page-size=200`, key).catch(() => []);
  const projectName = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const emps = (await db.query("SELECT employee_id, tracker_user_id, lower(email) AS email FROM employees WHERE status='active'")).rows;

  let synced = 0, linked = 0, unmatched = [];
  for (const u of users) {
    let emp = emps.find((e) => e.tracker_user_id === u.id) || emps.find((e) => e.email === (u.email || "").toLowerCase());
    if (!emp) { unmatched.push(u.email || u.name); continue; }
    if (emp.tracker_user_id !== u.id) {
      await db.query("UPDATE employees SET tracker_user_id=$1 WHERE employee_id=$2", [u.id, emp.employee_id]);
      linked++;
    }
    const start = new Date(startDate + "T00:00:00Z").toISOString();
    const end = new Date(endDate + "T23:59:59Z").toISOString();
    const entries = await clockifyGet(
      `/workspaces/${ws}/user/${u.id}/time-entries?start=${start}&end=${end}&page-size=1000`, key);
    for (const e of entries) {
      if (!e.timeInterval?.end) continue; // timer still running
      const hours = durationHours(e.timeInterval.duration);
      await upsertLog(emp.employee_id, "clockify-" + e.id, e.timeInterval.start.slice(0, 10),
        e.timeInterval.start, e.timeInterval.end, hours, projectName[e.projectId] || e.description || null, "clockify");
      synced++;
    }
  }
  return { mode: "clockify", synced, linked, unmatched };
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
      const startH = 8 + Math.floor(seeded(ds + tid) * 3);
      const st = new Date(`${ds}T${String(startH).padStart(2, "0")}:00:00Z`);
      const en = new Date(st.getTime() + hours * 3600000);
      await upsertLog(e.employee_id, `demo-${tid}-${ds}`, ds, st.toISOString(), en.toISOString(), hours,
        DEMO_PROJECTS[Math.floor(seeded(tid) * DEMO_PROJECTS.length)], "demo");
      synced++;
    }
  }
  return { mode: "demo", synced, linked: 0, unmatched: [] };
}

async function syncTimeLogs(startDate, endDate) {
  const key = await getApiKey();
  if (key) return syncClockify(key, startDate, endDate);
  return syncDemo(startDate, endDate);
}

module.exports = { syncTimeLogs, syncDemo, durationHours, getApiKey };
