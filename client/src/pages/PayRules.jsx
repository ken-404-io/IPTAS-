import { useEffect, useState } from "react";
import { api, fmtDate } from "../api.js";
import { PageHeader, Alert } from "../components/ui.jsx";

export default function PayRules({ user }) {
  const [rules, setRules] = useState([]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api("/rules").then((r) => {
    setRules(r);
    const c = r[0];
    if (c) setF({ rule_name: "", overtime_threshold: c.overtime_threshold, overtime_multiplier: c.overtime_multiplier,
      cpp_pct: (c.cpp_rate * 100).toFixed(2), ei_pct: (c.ei_rate * 100).toFixed(2),
      effective_date: new Date().toISOString().slice(0, 10) });
  }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const owner = user.role === "owner";
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      await api("/rules", { method: "POST", body: {
        rule_name: f.rule_name || `Rules from ${f.effective_date}`, overtime_threshold: Number(f.overtime_threshold), overtime_multiplier: Number(f.overtime_multiplier),
        cpp_rate: Number(f.cpp_pct) / 100, ei_rate: Number(f.ei_pct) / 100, effective_date: f.effective_date } });
      setMsg("New pay rules saved. They apply to pay periods ending on or after the effective date; approved payroll is not changed.");
      load();
    } catch (e2) { setErr(e2.message); }
  };
  return (
    <>
      <PageHeader title="Pay Rules" subtitle="Overtime threshold and multiplier, and the CPP and EI general rates used in computation." />
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      <div className="grid-side wide-left">
        {f && (
          <form className="card form" onSubmit={save}>
            <h3>{owner ? "Update pay rules" : "Current pay rules"}</h3>
            {!owner && <p className="tiny muted">Only the Business Owner can change pay rules.</p>}
            <fieldset disabled={!owner}>
              {owner && <label>Rule name<input value={f.rule_name} onChange={set("rule_name")} placeholder="e.g. 2027 rates" /></label>}
              <div className="row2">
                <label>Overtime after (hours per day)<input type="number" step="0.5" min="1" max="24" value={f.overtime_threshold} onChange={set("overtime_threshold")} required /></label>
                <label>Overtime multiplier<input type="number" step="0.05" min="1" value={f.overtime_multiplier} onChange={set("overtime_multiplier")} required /></label>
              </div>
              <div className="row2">
                <label>CPP rate (%)<input type="number" step="0.01" min="0" max="20" value={f.cpp_pct} onChange={set("cpp_pct")} required /></label>
                <label>EI rate (%)<input type="number" step="0.01" min="0" max="20" value={f.ei_pct} onChange={set("ei_pct")} required /></label>
              </div>
              {owner && <label>Effective date<input type="date" value={f.effective_date} onChange={set("effective_date")} required /></label>}
              {owner && <div className="form-actions"><button className="btn primary">Save new rules</button></div>}
            </fieldset>
          </form>
        )}
        <section className="card">
          <h3>How pay is computed</h3>
          <ol className="steps">
            <li><strong>Hourly:</strong> each day, the first hours up to the threshold (6 h) × rate, plus the hours above it × rate × multiplier (overtime is counted per day).</li>
            <li><strong>Fixed:</strong> the set amount per pay period; overtime (if eligible) uses the equivalent hourly rate = amount ÷ (threshold × 10 working days).</li>
            <li><strong>Deductions:</strong> CPP and EI at the general rates above, for employees paid in CAD (Canadian payroll).</li>
            <li><strong>Currency:</strong> USD pay is converted to CAD with the exchange rate entered when the payroll is computed (saved on each payroll record).</li>
          </ol>
          <p className="tiny muted">Each payroll stores the rule version it used, so old payslips stay correct when rules change.</p>
        </section>
      </div>
      <section className="card flush">
        <div className="card-head pad"><h3>Rule history</h3></div>
        <div className="table-wrap"><table>
          <colgroup><col /><col style={{ width: "18%" }} /><col style={{ width: "13%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} /></colgroup>
          <thead><tr><th>Name</th><th>Effective</th><th className="num">OT after</th><th className="num">OT ×</th><th className="num">CPP</th><th className="num">EI</th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.rule_id}><td>{r.rule_name}</td><td>{fmtDate(r.effective_date)}</td><td className="num">{r.overtime_threshold} h</td><td className="num">{r.overtime_multiplier}</td><td className="num">{(r.cpp_rate * 100).toFixed(2)}%</td><td className="num">{(r.ei_rate * 100).toFixed(2)}%</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}
