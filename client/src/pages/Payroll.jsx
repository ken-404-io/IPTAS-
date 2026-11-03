import { useEffect, useState } from "react";
import { api, money, hrs, periodLabel } from "../api.js";
import { PageHeader, Alert, Empty, PeriodSelect, Status, Modal } from "../components/ui.jsx";
import { SkRows, SkStat } from "../components/Skeleton.jsx";
import usePeriods from "../components/usePeriods.js";
import Icon from "../components/Icon.jsx";
import { checkNumber } from "../components/validation.jsx";

// PayPal payout statuses (transaction_status of a payout item, plus SENDING while the request is in progress)
const PAYOUT = {
  SENDING: ["Sending…", "computed"], PENDING: ["Pending", "computed"], ONHOLD: ["On hold", "computed"],
  UNCLAIMED: ["Unclaimed", "computed"], SUCCESS: ["Paid", "approved"],
  FAILED: ["Failed", "failed"], RETURNED: ["Returned", "failed"], BLOCKED: ["Blocked", "failed"], DENIED: ["Denied", "failed"], REFUNDED: ["Refunded", "failed"],
};
const RETRY = ["FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED"];
const DONE = ["SUCCESS", ...RETRY];
const payable = (i) => Number(i.net_pay) > 0 && (!i.payout_status || RETRY.includes(i.payout_status));
// "Paid" only once the employee clicks "Received" in the payment email
const received = (i) => i.received_at && !RETRY.includes(i.payout_status);
const waiting = (i) => i.paypal_batch_id && !i.received_at && !RETRY.includes(i.payout_status);
function Payout({ i }) {
  if (!i.payout_status) return <span className="tiny muted">{i.payout_error ? "Not sent" : "–"}</span>;
  if (received(i)) return <span className="badge approved" title={`${i.full_name} confirmed receiving it on ${new Date(i.received_at).toLocaleString("en-CA")}`}>Paid ✓</span>;
  const [label, cls] = i.payout_status === "SUCCESS" ? ["In PayPal", "computed"] : PAYOUT[i.payout_status] || [i.payout_status, "open"];
  const why = i.payout_error || (i.payout_status === "UNCLAIMED" ? `Waiting for ${i.email} to claim it with a PayPal account` : undefined);
  return (
    <span className="payout-cell"><span className={"badge " + cls} title={why}>{label}</span>
      {waiting(i) && <span className={"tiny " + (i.email_error ? "red" : "muted")} title={i.email_error || undefined}>
        {i.email_error ? "Email failed" : i.emailed_at ? "Emailed · awaiting “Received”" : "Not emailed"}</span>}
    </span>);
}

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
      {(i.payout_status || i.payout_error) && <div className="ps-row"><span>PayPal to {i.email}</span><strong><Payout i={i} /></strong></div>}
      {i.payout_error && <p className="tiny muted">{i.payout_error}</p>}
      {i.email_error && <p className="tiny red">{i.email_error}</p>}
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
  // Payouts still waiting at PayPal get their latest status when the period is opened
  const pending = (data?.items || []).some((i) => i.paypal_batch_id && !DONE.includes(i.payout_status));
  useEffect(() => {
    if (data?.paypal?.configured && pending) api(`/payroll/${data.period.period_id}/paypal/refresh`, { method: "POST" }).then((r) => r.updated && load()).catch(() => {});
  }, [data?.period?.period_id]);
  const act = async (what) => {
    if (what === "approve" && !window.confirm("Approve and lock this payroll? It can no longer be changed after approval.")) return;
    if (what === "pay" && !data?.paypal?.configured) {
      setMsg(""); setErr("PayPal is not connected yet. On Render → your service → Environment, add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (from developer.paypal.com → Apps & Credentials) and PAYPAL_ENV=sandbox, then wait for the restart and reload this page. Settings shows “PayPal payouts: Connected” when it works.");
      return;
    }
    if (what === "pay") {
      const list = (data?.items || []).filter(payable);
      const tot = {}; for (const i of list) tot[i.currency] = (tot[i.currency] || 0) + Number(i.net_pay);
      if (!window.confirm(`Send ${Object.entries(tot).map(([c, v]) => money(v, c)).join(" + ")} through PayPal${data.paypal.env === "sandbox" ? " (sandbox – test money)" : ""} to ${list.length} employee${list.length > 1 ? "s" : ""}?\n\n` +
        list.map((i) => `${i.full_name} – ${money(i.net_pay, i.currency)} → ${i.email}`).join("\n"))) return;
    }
    setBusy(what); setErr(""); setMsg("");
    try {
      if (what === "compute") { const r = await api(`/payroll/${periodId}/compute`, { method: "POST", body: { fx_rate: data?.has_usd ? Number(fx) : undefined } }); setMsg(`${r.sync ? `Hours synced from ${r.sync.mode === "clockify" ? "Clockify" : "sample data"} (${r.sync.synced} entries). ` : ""}Payroll computed for ${r.employees} employees. ${user.role === "owner" ? "Review it, then approve." : "The Business Owner can now review and approve it."}`); }
      else if (what === "pay") {
        const r = await api(`/payroll/${periodId}/paypal`, { method: "POST" });
        const e = r.email || {};
        setMsg(`PayPal${r.env === "sandbox" ? " sandbox" : ""} payout sent to ${r.sent} employee${r.sent > 1 ? "s" : ""} (${Object.entries(r.totals).map(([c, v]) => money(v, c)).join(" + ")}). ` +
          (!e.configured ? "Email is not set up, so employees were not emailed (set BREVO_API_KEY and EMAIL_FROM)."
            : `${e.sent} payment email${e.sent === 1 ? "" : "s"} sent; each turns “Paid” when the employee clicks “Received”.`));
        if (e.failed?.length) setErr(e.failed.join(" "));
      }
      else if (what === "email") { const r = await api(`/payroll/${periodId}/email`, { method: "POST" }); setMsg(`Payment email sent to ${r.sent} employee${r.sent === 1 ? "" : "s"}.`); if (r.failed?.length) setErr(r.failed.join(" ")); }
            else if (what === "refresh") { const r = await api(`/payroll/${periodId}/paypal/refresh`, { method: "POST" }); setMsg(r.updated ? `Updated the PayPal status of ${r.updated} payment${r.updated > 1 ? "s" : ""}.` : "No change in the PayPal status."); }
      else { await api(`/payroll/${periodId}/approve`, { method: "POST" }); setMsg("Payroll approved and locked."); }
      await load(); await reload(true);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  const p = data?.period; const items = data?.items || [];
  const fxError = data?.has_usd ? checkNumber(fx, { label: "USD → CAD rate", min: 0.5, max: 5, decimals: 4 }) : "";
  const sum = (k) => items.reduce((a, i) => a + Number(i[k]), 0);
  const toPay = items.filter(payable).length;
  const canPay = p?.status === "approved" && user.role === "owner";
  return (
    <>
      <PageHeader title="Payroll" subtitle="Compute gets the latest hours from Clockify, applies the pay rules, then the Owner approves.">
        <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
        {p && p.status !== "approved" && data?.has_usd && (
          <label className={"fx-input" + (fxError ? " invalid" : "")} title="Exchange rate used to convert USD pay to CAD for this payroll"><span className="label">USD → CAD</span>
            <input type="number" step="0.0001" min="0.5" max="5" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} aria-label="USD to CAD rate"
              aria-invalid={fxError ? true : undefined} aria-describedby={fxError ? "err-fx" : undefined} />
            {fxError && <span id="err-fx" className="fx-error" role="alert">{fxError}</span>}</label>
        )}
        {p && p.status !== "approved" && <button className="btn dark" onClick={() => act("compute")} disabled={!!busy || !!fxError} title={fxError || undefined}><Icon name="calc" /> {busy === "compute" ? "Syncing & computing…" : p.status === "computed" ? "Recompute" : "Compute payroll"}</button>}
        {canPay && toPay > 0 && <button className="btn primary" onClick={() => act("pay")} disabled={!!busy}><Icon name="wallet" /> {busy === "pay" ? "Sending…" : `Pay with PayPal (${toPay})`}</button>}
        {canPay && data?.email?.configured && items.some(waiting) && <button className="btn dark" onClick={() => act("email")} disabled={!!busy} title="Email everyone who has not clicked “Received” yet"><Icon name="sync" /> {busy === "email" ? "Emailing…" : "Email employees"}</button>}
        {p?.status === "approved" && data?.paypal?.configured && pending && <button className="btn dark" onClick={() => act("refresh")} disabled={!!busy}><Icon name="sync" /> {busy === "refresh" ? "Checking…" : "Refresh PayPal status"}</button>}
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
      {p?.status === "approved" && <Alert kind="info"><Icon name="lock" size={14} /> Approved and locked. Payslips keep the amounts and the pay rule used.
        {data?.paypal?.configured ? (toPay ? ` ${user.role === "owner" ? "Click “Pay with PayPal” to send" : "The Business Owner can send"} each employee's net pay to their email through PayPal${data.paypal.env === "sandbox" ? " (sandbox)" : ""}.` : "")
          : " To pay employees by email, connect PayPal (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server)."}</Alert>}
      <section className="card flush">
        {data && !items.length ? <Empty>No payroll computed for this period yet. Click “Compute payroll” – it gets the hours from Clockify automatically.</Empty> : (
          <div className="table-wrap"><table>
            <colgroup><col /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "11%" }} /><col style={{ width: "10%" }} /><col style={{ width: "9%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "100px" }} /><col style={{ width: "90px" }} /></colgroup>
            <thead><tr><th>Employee</th><th className="num">Reg. hrs</th><th className="num">OT hrs</th><th className="num">Gross</th><th className="num">CPP</th><th className="num">EI</th><th className="num">Net pay</th><th className="num">Net (CAD)</th><th>PayPal</th><th /></tr></thead>
            {!data ? <SkRows rows={8} cols={["two", "num", "num", "num", "num", "num", "num", "num", "text", "text"]} /> : <tbody>{items.map((i) => (
              <tr key={i.payroll_id} className="click" onClick={() => setSlip(i)}>
                <td><strong>{i.full_name}</strong><div className="tiny muted">{i.employment_type} · {i.currency}</div></td>
                <td className="num">{hrs(i.regular_hours)}</td><td className="num">{hrs(i.overtime_hours)}</td>
                <td className="num">{money(i.gross_pay, i.currency)}</td><td className="num">{money(i.cpp_deduction, i.currency)}</td><td className="num">{money(i.ei_deduction, i.currency)}</td>
                <td className="num"><strong>{money(i.net_pay, i.currency)}</strong></td><td className="num">{money(i.net_pay_cad)}</td>
                <td><Payout i={i} /></td>
                <td><span className="link">Payslip</span></td>
              </tr>))}
            </tbody>}
            {data && <tfoot><tr><td>Total</td><td className="num">{hrs(sum("regular_hours"))}</td><td className="num">{hrs(sum("overtime_hours"))}</td><td colSpan="4" /><td className="num">{money(sum("net_pay_cad"))}</td><td colSpan="2" /></tr></tfoot>}
          </table></div>
        )}
      </section>
      {slip && <Modal title={`Payslip – ${slip.full_name}`} onClose={() => setSlip(null)}><Payslip i={slip} /></Modal>}
    </>
  );
}
