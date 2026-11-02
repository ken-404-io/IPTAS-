import { useEffect, useState } from "react";
import { api, hrs, fmtDate, fmtDateTime } from "../api.js";
import { PageHeader, Alert, Empty, PeriodSelect, Status, Modal } from "../components/ui.jsx";
import usePeriods from "../components/usePeriods.js";
import Icon from "../components/Icon.jsx";

const timeIn = (t, tz) => t ? new Date(t).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: tz || "UTC" }) : "";
const SOURCE = { clockify: "Clockify", manual: "Manual", demo: "Sample" };

function syncMessage(r) {
  const parts = [`Sync complete (${r.mode === "clockify" ? "Clockify API" : "sample data"}): ${r.synced} entries synced`];
  if (r.linked) parts.push(`${r.linked} employees linked to Clockify`);
  if (r.removed) parts.push(`${r.removed} old entries removed`);
  let m = parts.join(", ") + ".";
  if (r.running) m += ` ${r.running} running timer${r.running > 1 ? "s were" : " was"} skipped (sync again after they stop).`;
  if (r.mode === "clockify" && r.admin_access === false) m += " The API key is not a workspace admin, so only the key owner's hours were synced.";
  if (r.unmatched?.length) m += ` Clockify users not matched to any employee: ${r.unmatched.join(", ")}.`;
  if (r.payroll_reset) m += " The payroll computed for this period was cleared; compute it again.";
  return m;
}

function AddEntry({ period, onClose, onSaved }) {
  const [emps, setEmps] = useState([]);
  const [f, setF] = useState({ employee_id: "", work_date: period.start_date, hours_worked: "", project: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api("/employees").then((r) => setEmps(r.filter((e) => e.status === "active"))).catch((e) => setErr(e.message)); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { const r = await api("/timelogs", { method: "POST", body: { ...f, hours_worked: Number(f.hours_worked) } }); onSaved(r); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={save}>
      <Alert>{err}</Alert>
      <p className="tiny muted">Use this for hours that were not tracked in Clockify, or for corrections. Manual entries are kept when you sync again.</p>
      <label>Employee<select value={f.employee_id} onChange={set("employee_id")} required>
        <option value="">Select an employee…</option>{emps.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
      </select></label>
      <div className="row2">
        <label>Date<input type="date" min={period.start_date} max={period.end_date} value={f.work_date} onChange={set("work_date")} required /></label>
        <label>Hours<input type="number" min="0.25" max="24" step="0.25" value={f.hours_worked} onChange={set("hours_worked")} required /></label>
      </div>
      <label>Note / project<input value={f.project} onChange={set("project")} placeholder="e.g. Forgot to start the timer" maxLength={100} /></label>
      <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Add entry"}</button></div>
    </form>
  );
}

export default function TimeLogs() {
  const { periods, periodId, setPeriodId, period, reload } = usePeriods();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false); const [emp, setEmp] = useState(""); const [adding, setAdding] = useState(false);
  const load = () => periodId && api(`/timelogs?period_id=${periodId}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setMsg(""); setErr(""); load(); }, [periodId]);
  const sync = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await api("/timelogs/sync", { method: "POST", body: { period_id: periodId } });
      setMsg(syncMessage(r));
      await load(); await reload(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async (l) => {
    if (!window.confirm(`Delete the manual entry of ${hrs(l.hours_worked)} h for ${l.full_name} on ${fmtDate(l.work_date)}?`)) return;
    setErr(""); setMsg("");
    try {
      const r = await api(`/timelogs/${l.log_id}`, { method: "DELETE" });
      setMsg("Manual entry deleted." + (r.payroll_reset ? " The payroll computed for this period was cleared; compute it again." : ""));
      await load(); await reload(true);
    } catch (e) { setErr(e.message); }
  };
  const tz = data?.timezone;
  const locked = period?.status === "approved";
  const logs = (data?.logs || []).filter((l) => !emp || String(l.employee_id) === emp);
  const totals = {};
  for (const l of data?.logs || []) totals[l.full_name] = (totals[l.full_name] || 0) + Number(l.hours_worked);
  const names = Object.keys(totals).sort();
  return (
    <>
      <PageHeader title="Time Logs" subtitle="Hours pulled from Clockify through its API, plus manual corrections.">
        <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
        <button className="btn ghost" onClick={() => setAdding(true)} disabled={!period || locked}><Icon name="plus" /> Add entry</button>
        <button className="btn primary" onClick={sync} disabled={busy || !period || locked}><Icon name="sync" /> {busy ? "Syncing…" : "Sync time logs"}</button>
      </PageHeader>
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      {data && !data.clockify_connected && (
        <Alert kind="info">{data.demo_mode
          ? "Clockify is not connected, so “Sync time logs” creates sample hours for demonstration. Connect Clockify in Settings to use real hours."
          : "Clockify is not connected. The Business Owner can add the API key in Settings. You can still add hours manually."}</Alert>
      )}
      {locked && <Alert kind="info">This pay period is approved and locked, so its time logs can no longer change.</Alert>}
      {data?.last_sync && <p className="tiny muted">Last sync: {fmtDateTime(data.last_sync.at)} · {data.last_sync.mode === "clockify" ? "Clockify" : "Sample data"} · period {data.last_sync.period}</p>}
      <div className="grid-side">
        <section className="card">
          <h3>Totals by employee</h3>
          {!names.length ? <Empty>No hours yet. Click “Sync time logs”.</Empty> : (
            <ul className="totals">{names.map((n) => <li key={n}><span>{n}</span><strong>{hrs(totals[n])} h</strong></li>)}
              <li className="sum"><span>Total</span><strong>{hrs(Object.values(totals).reduce((a, b) => a + b, 0))} h</strong></li></ul>
          )}
        </section>
        <section className="card flush">
          <div className="card-head pad">
            <h3>Entries {period && <Status value={period.status} />}</h3>
            <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Filter by employee">
              <option value="">All employees</option>
              {[...new Map((data?.logs || []).map((l) => [l.employee_id, l.full_name]))].map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </div>
          {!data ? <div className="loading">Loading…</div> : !logs.length ? <Empty>No time entries in this period.</Empty> : (
            <div className="table-wrap tall"><table>
              <thead><tr><th>Date</th><th>Employee</th><th>Start – End{tz ? ` (${tz.split("/").pop().replace(/_/g, " ")} time)` : ""}</th><th>Project / note</th><th className="num">Hours</th><th>Source</th><th /></tr></thead>
              <tbody>{logs.map((l) => (
                <tr key={l.log_id}>
                  <td>{fmtDate(l.work_date)}</td><td>{l.full_name}</td>
                  <td>{l.start_time ? `${timeIn(l.start_time, tz)} – ${timeIn(l.end_time, tz)}` : <span className="muted">–</span>}</td>
                  <td>{l.project}</td><td className="num">{hrs(l.hours_worked)}</td>
                  <td><span className={"pill " + l.source}>{SOURCE[l.source] || l.source}</span></td>
                  <td>{l.source === "manual" && !locked && <button className="icon-btn" onClick={() => remove(l)} aria-label="Delete entry"><Icon name="trash" /></button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
      {adding && period && (
        <Modal title="Add time entry" onClose={() => setAdding(false)}>
          <AddEntry period={period} onClose={() => setAdding(false)} onSaved={async (r) => {
            setAdding(false); setErr("");
            setMsg("Time entry added." + (r.payroll_reset ? " The payroll computed for this period was cleared; compute it again." : ""));
            await load(); await reload(true);
          }} />
        </Modal>
      )}
    </>
  );
}
