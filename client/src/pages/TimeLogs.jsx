import { useEffect, useRef, useState } from "react";
import { api, hrs, fmtDate, fmtDateTime } from "../api.js";
import { PageHeader, Alert, Empty, PeriodSelect, Status } from "../components/ui.jsx";
import usePeriods from "../components/usePeriods.js";
import Icon from "../components/Icon.jsx";

const timeIn = (t, tz) => t ? new Date(t).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: tz || "UTC" }) : "";
const SOURCE = { clockify: "Clockify", demo: "Sample" };
const AUTO_SYNC_MINUTES = 5; // re-sync an open period automatically when its last sync is older than this

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

export default function TimeLogs() {
  const { periods, periodId, setPeriodId, period, reload } = usePeriods({ preferCurrent: true });
  const autoSynced = useRef(new Set());
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false); const [emp, setEmp] = useState("");
  const load = () => periodId ? api(`/timelogs?period_id=${periodId}`).then((d) => { setData(d); return d; }).catch((e) => { setErr(e.message); return null; }) : Promise.resolve(null);
  const sync = async (auto = false) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await api("/timelogs/sync", { method: "POST", body: { period_id: periodId } });
      setMsg((auto ? "Updated from Clockify automatically. " : "") + syncMessage(r));
      await load(); await reload(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  // Opening a period that is still open gets its latest hours from Clockify automatically
  useEffect(() => {
    setData(null); setMsg(""); setErr("");
    load().then((d) => {
      const p = d?.period;
      if (!d || !p || p.status !== "open" || !d.clockify_connected || autoSynced.current.has(p.period_id)) return;
      autoSynced.current.add(p.period_id);
      const fresh = d.last_sync?.mode === "clockify" && d.last_sync.period === `${p.start_date} to ${p.end_date}` &&
        Date.now() - new Date(d.last_sync.at).getTime() < AUTO_SYNC_MINUTES * 60000;
      if (!fresh) sync(true);
    });
  }, [periodId]);
  const tz = data?.timezone;
  const locked = period?.status === "approved";
  const logs = (data?.logs || []).filter((l) => !emp || String(l.employee_id) === emp);
  const totals = {};
  for (const l of data?.logs || []) totals[l.full_name] = (totals[l.full_name] || 0) + Number(l.hours_worked);
  const names = Object.keys(totals).sort();
  return (
    <>
      <PageHeader title="Time Logs" subtitle="Hours are pulled from Clockify automatically when you open a pay period (and every 30 minutes on the server).">
        <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
        <button className="btn primary" onClick={() => sync(false)} disabled={busy || !period || locked}><Icon name="sync" /> {busy ? "Syncing…" : "Sync now"}</button>
      </PageHeader>
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      {data && !data.clockify_connected && (
        <Alert kind="info">{data.demo_mode
          ? "Clockify is not connected, so syncing creates sample hours for demonstration. Connect Clockify to use real hours (see Settings)."
          : "Clockify is not connected. Set CLOCKIFY_API_KEY in the server's environment variables (see Settings)."}</Alert>
      )}
      {locked && <Alert kind="info">This pay period is approved and locked, so its time logs can no longer change.</Alert>}
      {data?.last_sync && <p className="tiny muted">Last sync: {fmtDateTime(data.last_sync.at)} · {data.last_sync.mode === "clockify" ? "Clockify" : "Sample data"} · period {data.last_sync.period}</p>}
      <div className="grid-side">
        <section className="card">
          <h3>Totals by employee</h3>
          {!names.length ? <Empty>No hours yet in this pay period.</Empty> : (
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
              <thead><tr><th>Date</th><th>Employee</th><th>Start – End{tz ? ` (${tz.split("/").pop().replace(/_/g, " ")} time)` : ""}</th><th className="num">Hours</th><th>Source</th></tr></thead>
              <tbody>{logs.map((l) => (
                <tr key={l.log_id}>
                  <td>{fmtDate(l.work_date)}</td><td>{l.full_name}</td>
                  <td>{l.start_time ? `${timeIn(l.start_time, tz)} – ${timeIn(l.end_time, tz)}` : <span className="muted">–</span>}</td>
                  <td className="num">{hrs(l.hours_worked)}</td>
                  <td><span className={"pill " + l.source}>{SOURCE[l.source] || l.source}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
