import { useEffect, useState } from "react";
import { api, hrs, fmtDate, fmtDateTime } from "../api.js";
import { PageHeader, Alert, Empty, PeriodSelect, Status } from "../components/ui.jsx";
import usePeriods from "../components/usePeriods.js";
import Icon from "../components/Icon.jsx";

const time = (t) => t ? new Date(t).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "";

export default function TimeLogs() {
  const { periods, periodId, setPeriodId, period, reload } = usePeriods();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false); const [emp, setEmp] = useState("");
  const load = () => periodId && api(`/timelogs?period_id=${periodId}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); load(); }, [periodId]);
  const sync = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await api("/timelogs/sync", { method: "POST", body: { period_id: periodId } });
      setMsg(`Sync complete (${r.mode === "clockify" ? "Clockify API" : "demo mode"}): ${r.synced} entries synced${r.linked ? `, ${r.linked} employees linked` : ""}.${r.unmatched?.length ? ` Not matched to any employee: ${r.unmatched.join(", ")}` : ""}`);
      await load(); await reload(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const logs = (data?.logs || []).filter((l) => !emp || String(l.employee_id) === emp);
  const totals = {};
  for (const l of data?.logs || []) totals[l.full_name] = (totals[l.full_name] || 0) + Number(l.hours_worked);
  const names = Object.keys(totals).sort();
  return (
    <>
      <PageHeader title="Time Logs" subtitle="Hours pulled from the time-tracker through its API.">
        <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
        <button className="btn primary" onClick={sync} disabled={busy || !period || period.status === "approved"}><Icon name="sync" /> {busy ? "Syncing…" : "Sync time logs"}</button>
      </PageHeader>
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      {period?.status === "approved" && <Alert kind="info">This pay period is approved and locked, so its time logs can no longer be re-synced.</Alert>}
      {data?.last_sync && <p className="tiny muted">Last sync: {fmtDateTime(data.last_sync.at)} · {data.last_sync.mode === "clockify" ? "Clockify" : "Demo mode"} · period {data.last_sync.period}</p>}
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
              <thead><tr><th>Date</th><th>Employee</th><th>Start – End (UTC)</th><th>Project</th><th className="num">Hours</th><th>Source</th></tr></thead>
              <tbody>{logs.map((l) => (
                <tr key={l.log_id}><td>{fmtDate(l.work_date)}</td><td>{l.full_name}</td><td>{time(l.start_time)} – {time(l.end_time)}</td><td>{l.project}</td><td className="num">{hrs(l.hours_worked)}</td><td><span className={"pill " + l.source}>{l.source}</span></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
