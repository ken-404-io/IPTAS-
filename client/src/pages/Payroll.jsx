import { useEffect, useState } from "react";
import { api, money, hrs, periodLabel } from "../api.js";
import { PageHeader, Alert, Empty, PeriodSelect, Status, Modal } from "../components/ui.jsx";
import { SkRows, SkStat } from "../components/Skeleton.jsx";
import usePeriods from "../components/usePeriods.js";
import Icon from "../components/Icon.jsx";

function Payslip({ i }) {
  return (
    <div className="payslip">
      <div className="ps-row"><span>Employment type</span><strong>{i.employment_type === "hourly" ? `Hourly · ${money(i.pay_rate, i.currency)}/h` : `Fixed · ${money(i.pay_rate, i.currency)}/period`}</strong></div>
      <div className="ps-row"><span>Regular hours</span><strong>{hrs(i.regular_hours)}</strong></div>
      <div className="ps-row"><span>Overtime hours</span><strong>{hrs(i.overtime_hours)}</strong></div>
      <div className="ps-row big"><span>Gross pay</span><strong>{money(i.gross_pay, i.currency)}</strong></div>
      <div className="ps-row neg"><span>CPP deduction</span><strong>{Number(i.cpp_deduction) ? "– " : ""}{money(i.cpp_deduction, i.currency)}</strong></div>
      <div className="ps-row neg"><span>EI deduction</span><strong>{Number(i.ei_deduction) ? "– " : ""}{money(i.ei_deduction, i.currency)}</strong></div>
      <div className="ps-row total"><span>Net pay</span><strong>{money(i.net_pay, i.currency)}</strong></div>
      {i.currency === "USD" && <div className="ps-row"><span>Net pay in CAD (× {i.fx_rate})</span><strong>{money(i.net_pay_cad)}</strong></div>}
      <p className="tiny muted">Computed by {i.computed_by_name || "–"}. {i.approved_by_name ? `Approved by ${i.approved_by_name}.` : "Not yet approved."}</p>
    </div>
  );
}

export default function Payroll({ user }) {
  const { periods, periodId, setPeriodId, reload } = usePeriods();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(""); const [slip, setSlip] = useState(null); const [fx, setFx] = useState("");
  const load = () => periodId && api(`/payroll/${periodId}`).then((d) => { setData(d); setFx(String(d.fx_rate)); }).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setMsg(""); load(); }, [periodId]);
  const act = async (what) => {
    if (what === "approve" && !window.confirm("Approve and lock this payroll? It can no longer be changed after approval.")) return;
    setBusy(what); setErr(""); setMsg("");
    try {
      if (what === "compute") { const r = await api(`/payroll/${periodId}/compute`, { method: "POST", body: { fx_rate: data?.has_usd ? Number(fx) : undefined } }); setMsg(`${r.sync ? `Hours synced from ${r.sync.mode === "clockify" ? "Clockify" : "sample data"} (${r.sync.synced} entries). ` : ""}Payroll computed for ${r.employees} employees. ${user.role === "owner" ? "Review it, then approve." : "The Business Owner can now review and approve it."}`); }
      else { await api(`/payroll/${periodId}/approve`, { method: "POST" }); setMsg("Payroll approved and locked."); }
      await load(); await reload(true);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  const p = data?.period; const items = data?.items || [];
  const sum = (k) => items.reduce((a, i) => a + Number(i[k]), 0);
  return (
    <>
      <PageHeader title="Payroll" subtitle="Compute gets the latest hours from Clockify, applies the pay rules, then the Owner approves.">
        <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
        {p && p.status !== "approved" && data?.has_usd && (
          <label className="fx-input" title="Exchange rate used to convert USD pay to CAD for this payroll"><span className="label">USD → CAD</span>
            <input type="number" step="0.0001" min="0.5" max="5" value={fx} onChange={(e) => setFx(e.target.value)} aria-label="USD to CAD rate" /></label>
        )}
        {p && p.status !== "approved" && <button className="btn dark" onClick={() => act("compute")} disabled={!!busy}><Icon name="calc" /> {busy === "compute" ? "Syncing & computing…" : p.status === "computed" ? "Recompute" : "Compute payroll"}</button>}
        {p && p.status === "computed" && user.role === "owner" && <button className="btn primary" onClick={() => act("approve")} disabled={!!busy}><Icon name="check" /> {busy === "approve" ? "Approving…" : "Approve payroll"}</button>}
      </PageHeader>
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      {!data && (
        <div className="status-strip" aria-busy="true">{[0, 1, 2, 3].map((i) => <SkStat key={i} big={16} sub={false} />)}</div>
      )}
      {p && (
        <div className="status-strip">
          <div><span className="muted">Pay period</span><strong>{periodLabel(p)}</strong></div>
          <div><span className="muted">Status</span><Status value={p.status} /></div>
          <div><span className="muted">Pay rules</span><strong>{data.rule?.rule_name}</strong></div>
          <div><span className="muted">Total net pay (CAD)</span><strong className="red">{money(sum("net_pay_cad"))}</strong></div>
        </div>
      )}
      {p?.status === "computed" && user.role !== "owner" && <Alert kind="info">Waiting for the Business Owner to approve this payroll.</Alert>}
      {p?.status === "approved" && <Alert kind="info"><Icon name="lock" size={14} /> Approved and locked. Payslips keep the amounts and the pay rule used.</Alert>}
      <section className="card flush">
        {data && !items.length ? <Empty>No payroll computed for this period yet. Click “Compute payroll” – it gets the hours from Clockify automatically.</Empty> : (
          <div className="table-wrap"><table>
            <colgroup><col /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "11%" }} /><col style={{ width: "10%" }} /><col style={{ width: "9%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "90px" }} /></colgroup>
            <thead><tr><th>Employee</th><th className="num">Reg. hrs</th><th className="num">OT hrs</th><th className="num">Gross</th><th className="num">CPP</th><th className="num">EI</th><th className="num">Net pay</th><th className="num">Net (CAD)</th><th /></tr></thead>
            {!data ? <SkRows rows={8} cols={["two", "num", "num", "num", "num", "num", "num", "num", "text"]} /> : <tbody>{items.map((i) => (
              <tr key={i.payroll_id} className="click" onClick={() => setSlip(i)}>
                <td><strong>{i.full_name}</strong><div className="tiny muted">{i.employment_type} · {i.currency}</div></td>
                <td className="num">{hrs(i.regular_hours)}</td><td className="num">{hrs(i.overtime_hours)}</td>
                <td className="num">{money(i.gross_pay, i.currency)}</td><td className="num">{money(i.cpp_deduction, i.currency)}</td><td className="num">{money(i.ei_deduction, i.currency)}</td>
                <td className="num"><strong>{money(i.net_pay, i.currency)}</strong></td><td className="num">{money(i.net_pay_cad)}</td>
                <td><span className="link">Payslip</span></td>
              </tr>))}
            </tbody>}
            {data && <tfoot><tr><td>Total</td><td className="num">{hrs(sum("regular_hours"))}</td><td className="num">{hrs(sum("overtime_hours"))}</td><td colSpan="4" /><td className="num">{money(sum("net_pay_cad"))}</td><td /></tr></tfoot>}
          </table></div>
        )}
      </section>
      {slip && <Modal title={`Payslip – ${slip.full_name}`} onClose={() => setSlip(null)}><Payslip i={slip} /></Modal>}
    </>
  );
}
