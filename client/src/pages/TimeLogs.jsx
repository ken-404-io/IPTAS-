import { useEffect, useRef, useState } from "react";
import { api, hrs, fmtDate, fmtDateTime } from "../api.js";
import { PageHeader, Alert, Empty, PeriodSelect, Status, Modal } from "../components/ui.jsx";
import DailyChart, { scaleFor, REG_COLOR, OT_COLOR } from "../components/DailyChart.jsx";
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
  const [busy, setBusy] = useState(false); const [emp, setEmp] = useState(""); const [pick, setPick] = useState(null); // emp = employee_id as a string
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
  const days = (data?.daily || []).filter((d) => !emp || String(d.employee_id) === String(emp));
  const ot = data?.overtime_threshold ?? 6;
  // Period totals per employee, from the daily split
  const totals = {};
  for (const d of data?.daily || []) {
    const t = totals[d.employee_id] || (totals[d.employee_id] = { name: d.full_name, hours: 0, regular: 0, overtime: 0, byDate: {} });
    t.hours += d.hours; t.regular += d.regular; t.overtime += d.overtime; t.byDate[d.work_date] = d;
  }
  const ids = Object.keys(totals).sort((a, b) => totals[a].name.localeCompare(totals[b].name));
  const sum = (k) => ids.reduce((a, id) => a + totals[id][k], 0);
  const shownIds = ids.filter((id) => !emp || id === emp);
  // Every day of the pay period, so days without hours show as gaps
  const dates = [];
  if (data?.period) for (let d = new Date(data.period.start_date + "T00:00:00Z"); d.toISOString().slice(0, 10) <= data.period.end_date; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  const scale = scaleFor(data?.daily || [], ot); // one scale for every employee, so the charts compare fairly
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
      {ids.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Hours per day by employee</h3>
            <span className="legend chart-legend">
              <span><i className="sw" style={{ background: REG_COLOR }} /> Regular (first {hrs(ot)} h)</span>
              <span><i className="sw" style={{ background: OT_COLOR }} /> Overtime</span>
              <span><i className="sw line" /> {hrs(ot)} h daily limit</span>
            </span>
          </div>
          <div className="chart-grid">
            {shownIds.map((id) => <DailyChart key={id} name={totals[id].name} dates={dates} byDate={totals[id].byDate} threshold={ot} scale={scale} onPick={setPick} />)}
          </div>
          <p className="tiny muted">Hover a day for its hours; click a day or a table row to see every time entry. The table below has the same numbers.</p>
        </section>
      )}
      <div className="grid-side">
        <section className="card">
          <h3>Totals by employee</h3>
          {!ids.length ? <Empty>No hours yet in this pay period.</Empty> : (
            <ul className="totals">{ids.map((id) => (
              <li key={id}><button type="button" className={"link-row" + (emp === id ? " sel" : "")} onClick={() => setEmp(emp === id ? "" : id)} title="Show only this employee">
                <span>{totals[id].name}<span className="tiny muted day-split">{hrs(totals[id].regular)} regular · {hrs(totals[id].overtime)} OT</span></span><strong>{hrs(totals[id].hours)} h</strong></button></li>))}
              <li className="sum"><span>Total<span className="tiny muted day-split">{hrs(sum("regular"))} regular · {hrs(sum("overtime"))} OT</span></span><strong>{hrs(sum("hours"))} h</strong></li></ul>
          )}
          <p className="tiny muted">Overtime is counted per day: the first {hrs(ot)} hours of each day are regular, hours above {hrs(ot)} are overtime.</p>
        </section>
        <section className="card flush">
          <div className="card-head pad">
            <h3>Hours per day {period && <Status value={period.status} />}</h3>
            <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Filter by employee">
              <option value="">All employees</option>
              {ids.map((id) => <option key={id} value={id}>{totals[id].name}</option>)}
            </select>
          </div>
          {!data ? <div className="loading">Loading…</div> : !days.length ? <Empty>No time entries in this period.</Empty> : (
            <div className="table-wrap tall"><table>
              <thead><tr><th>Date</th><th>Employee</th><th>Time entries{tz ? ` (${tz.split("/").pop().replace(/_/g, " ")} time)` : ""}</th>
                <th className="num">Total</th><th className="num">Regular</th><th className="num">Overtime</th></tr></thead>
              <tbody>{days.map((d) => (
                <tr key={d.employee_id + d.work_date} className="click" onClick={() => setPick(d)} title="Show all time entries for this day">
                  <td className="nowrap">{fmtDate(d.work_date)}</td><td>{d.full_name}</td>
                  <td className="tiny">{d.entries.slice(0, 3).map((e) => (
                    <div key={e.log_id}>{e.start_time ? `${timeIn(e.start_time, tz)} – ${timeIn(e.end_time, tz)}` : "–"} <span className="muted">({hrs(e.hours)} h)</span>
                      {e.source !== "clockify" && <span className={"pill " + e.source}> {SOURCE[e.source] || e.source}</span>}</div>))}
                    {d.entries.length > 3 && <div className="link">+{d.entries.length - 3} more entries</div>}</td>
                  <td className="num"><strong>{hrs(d.hours)}</strong></td>
                  <td className="num">{hrs(d.regular)}</td>
                  <td className={"num" + (d.overtime > 0 ? " ot-cell" : "")}>{hrs(d.overtime)}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td colSpan="3">Total</td><td className="num">{hrs(days.reduce((a, d) => a + d.hours, 0))}</td>
                <td className="num">{hrs(days.reduce((a, d) => a + d.regular, 0))}</td><td className="num">{hrs(days.reduce((a, d) => a + d.overtime, 0))}</td></tr></tfoot>
            </table></div>
          )}
        </section>
      </div>
      {pick && (
        <Modal title={`${pick.full_name} – ${fmtDate(pick.work_date)}`} onClose={() => setPick(null)}>
          <div className="status-strip day-strip">
            <div><span className="muted">Total</span><strong>{hrs(pick.hours)} h</strong></div>
            <div><span className="muted"><i className="sw" style={{ background: REG_COLOR }} /> Regular</span><strong>{hrs(pick.regular)} h</strong></div>
            <div><span className="muted"><i className="sw" style={{ background: OT_COLOR }} /> Overtime</span><strong>{hrs(pick.overtime)} h</strong></div>
          </div>
          <div className="table-wrap tall"><table>
            <thead><tr><th>#</th><th>Start</th><th>End</th><th className="num">Hours</th><th>Source</th></tr></thead>
            <tbody>{pick.entries.map((e, i) => (
              <tr key={e.log_id}><td className="muted">{i + 1}</td><td>{e.start_time ? timeIn(e.start_time, tz) : "–"}</td><td>{e.end_time ? timeIn(e.end_time, tz) : "–"}</td>
                <td className="num">{hrs(e.hours)}</td><td><span className={"pill " + e.source}>{SOURCE[e.source] || e.source}</span></td></tr>))}</tbody>
            <tfoot><tr><td colSpan="3">{pick.entries.length} entr{pick.entries.length === 1 ? "y" : "ies"}</td><td className="num">{hrs(pick.hours)}</td><td /></tr></tfoot>
          </table></div>
          <p className="tiny muted">The first {hrs(ot)} hours of the day are regular; hours above {hrs(ot)} are overtime. Times are {tz?.split("/").pop().replace(/_/g, " ")} time. To change an entry, edit it in Clockify – IPTAS picks it up on the next sync.</p>
        </Modal>
      )}
    </>
  );
}
