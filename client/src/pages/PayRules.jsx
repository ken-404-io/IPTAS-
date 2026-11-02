import { useEffect, useState } from "react";
import { api, fmtDate } from "../api.js";
import { PageHeader, Alert, Modal } from "../components/ui.jsx";
import { Sk, SkRows, SkStat } from "../components/Skeleton.jsx";
import Icon from "../components/Icon.jsx";
import { useValidation, FieldError, checkNumber, checkDate } from "../components/validation.jsx";

const pct = (v) => `${(Number(v) * 100).toFixed(2)}%`;

export default function PayRules({ user }) {
  const [rules, setRules] = useState(null);
  const [f, setF] = useState(null); // form values while editing (null = closed)
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => api("/rules").then(setRules).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const owner = user.role === "owner";
  const today = new Date().toISOString().slice(0, 10);
  // Rules in effect today: the newest one whose effective date has started (list is newest first)
  const current = rules && (rules.find((r) => String(r.effective_date).slice(0, 10) <= today) || rules[0]);
  const upcoming = rules?.find((r) => String(r.effective_date).slice(0, 10) > today);

  const edit = () => v.reset() || setF({ rule_name: "", overtime_threshold: current.overtime_threshold, overtime_multiplier: current.overtime_multiplier,
    cpp_pct: (current.cpp_rate * 100).toFixed(2), ei_pct: (current.ei_rate * 100).toFixed(2), effective_date: today });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const v = useValidation(f, (x) => !x ? {} : ({
    overtime_threshold: checkNumber(x.overtime_threshold, { label: "Overtime after", min: 1, max: 24, decimals: 2 }),
    overtime_multiplier: checkNumber(x.overtime_multiplier, { label: "Overtime multiplier", min: 1, max: 3, decimals: 2 }),
    cpp_pct: checkNumber(x.cpp_pct, { label: "CPP rate", min: 0, max: 20, decimals: 2 }),
    ei_pct: checkNumber(x.ei_pct, { label: "EI rate", min: 0, max: 20, decimals: 2 }),
    effective_date: checkDate(x.effective_date, { label: "Effective date" }),
    rule_name: x.rule_name.trim().length > 50 ? "Name must be 50 characters or fewer." : "",
  }));
  const save = async (e) => {
    e.preventDefault(); setErr(""); setMsg(""); v.touchAll();
    if (!v.valid) return;
    setBusy(true);
    try {
      await api("/rules", { method: "POST", body: {
        rule_name: f.rule_name || `Rules from ${f.effective_date}`, overtime_threshold: Number(f.overtime_threshold), overtime_multiplier: Number(f.overtime_multiplier),
        cpp_rate: Number(f.cpp_pct) / 100, ei_rate: Number(f.ei_pct) / 100, effective_date: f.effective_date } });
      setF(null);
      setMsg("New pay rules saved. They apply to pay periods ending on or after the effective date; approved payroll is not changed.");
      load();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Pay Rules" subtitle="The rates used to compute pay.">
        {owner && current && <button className="btn primary" onClick={edit}><Icon name="edit" /> Edit rules</button>}
      </PageHeader>
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>

      {!rules ? (
        <section className="card rules-now" aria-busy="true">
          <div className="rules-now-head"><Sk w={70} h={10} /><Sk w={190} h={10} /></div>
          <div className="rules-grid">{[0, 1, 2, 3].map((i) => <div key={i}><SkStat big={26} sub={false} /></div>)}</div>
        </section>
      ) : current && (
        <section className="card rules-now">
          <div className="rules-now-head">
            <span className="label">In effect</span>
            <span className="muted tiny">{current.rule_name} · since {fmtDate(current.effective_date)}</span>
          </div>
          <div className="rules-grid">
            <div><span className="label">Overtime after</span><strong>{Number(current.overtime_threshold)} h<small> / day</small></strong></div>
            <div><span className="label">Overtime rate</span><strong>× {Number(current.overtime_multiplier)}</strong></div>
            <div><span className="label">CPP</span><strong>{pct(current.cpp_rate)}</strong></div>
            <div><span className="label">EI</span><strong>{pct(current.ei_rate)}</strong></div>
          </div>
          {upcoming && <p className="tiny muted rules-next">Next: {upcoming.rule_name}, from {fmtDate(upcoming.effective_date)}.</p>}
        </section>
      )}

      <details className="card how">
        <summary>How pay is computed</summary>
        <ul>
          <li><strong>Hourly</strong> – the first {current ? Number(current.overtime_threshold) : 6} hours of each day at the regular rate; hours above that at rate × multiplier.</li>
          <li><strong>Fixed</strong> – the set amount per pay period; overtime (if eligible) at amount ÷ (threshold × 10 working days).</li>
          <li><strong>Deductions</strong> – CPP and EI for employees paid in CAD.</li>
          <li><strong>Currency</strong> – USD pay converted to CAD at the rate entered when computing payroll.</li>
        </ul>
        <p className="tiny muted">Each payroll keeps the rule version it used, so past payslips never change.</p>
      </details>

      {(!rules || rules.length > 0) && (
        <section className="card flush">
          <div className="card-head pad"><h3>History</h3></div>
          <div className="table-wrap"><table>
            <colgroup><col /><col style={{ width: "18%" }} /><col style={{ width: "13%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /></colgroup>
            <thead><tr><th>Name</th><th>Effective</th><th className="num">OT after</th><th className="num">OT ×</th><th className="num">CPP</th><th className="num">EI</th></tr></thead>
            {!rules ? <SkRows rows={2} cols={["text", "text", "num", "num", "num", "num"]} /> : <tbody>{rules.map((r) => (
              <tr key={r.rule_id}>
                <td>{r.rule_name}{r.rule_id === current?.rule_id && <span className="badge active rule-badge">Current</span>}</td>
                <td>{fmtDate(r.effective_date)}</td><td className="num">{Number(r.overtime_threshold)} h</td><td className="num">{Number(r.overtime_multiplier)}</td>
                <td className="num">{pct(r.cpp_rate)}</td><td className="num">{pct(r.ei_rate)}</td>
              </tr>
            ))}</tbody>}
          </table></div>
        </section>
      )}
      {!owner && <p className="tiny muted">Only the Business Owner can change pay rules.</p>}

      {f && (
        <Modal title="Edit pay rules" onClose={() => setF(null)}>
          <form className="form" onSubmit={save} noValidate>
            <Alert>{err}</Alert>
            <p className="tiny muted">Saving creates a new version from the effective date. Approved payroll keeps the rules it used.</p>
            <div className="row2">
              <label>Overtime after (hours per day)<input type="number" step="0.5" min="1" max="24" inputMode="decimal" value={f.overtime_threshold} onChange={set("overtime_threshold")} {...v.bind("overtime_threshold")} /><FieldError name="overtime_threshold" msg={v.shown("overtime_threshold")} /></label>
              <label>Overtime multiplier<input type="number" step="0.05" min="1" max="3" inputMode="decimal" value={f.overtime_multiplier} onChange={set("overtime_multiplier")} {...v.bind("overtime_multiplier")} /><FieldError name="overtime_multiplier" msg={v.shown("overtime_multiplier")} /></label>
            </div>
            <div className="row2">
              <label>CPP rate (%)<input type="number" step="0.01" min="0" max="20" inputMode="decimal" value={f.cpp_pct} onChange={set("cpp_pct")} {...v.bind("cpp_pct")} /><FieldError name="cpp_pct" msg={v.shown("cpp_pct")} /></label>
              <label>EI rate (%)<input type="number" step="0.01" min="0" max="20" inputMode="decimal" value={f.ei_pct} onChange={set("ei_pct")} {...v.bind("ei_pct")} /><FieldError name="ei_pct" msg={v.shown("ei_pct")} /></label>
            </div>
            <div className="row2">
              <label>Effective date<input type="date" value={f.effective_date} onChange={set("effective_date")} {...v.bind("effective_date")} /><FieldError name="effective_date" msg={v.shown("effective_date")} /></label>
              <label>Name (optional)<input value={f.rule_name} onChange={set("rule_name")} {...v.bind("rule_name")} placeholder="e.g. 2027 rates" /><FieldError name="rule_name" msg={v.shown("rule_name")} /></label>
            </div>
            <div className="form-actions"><button type="button" className="btn ghost" onClick={() => setF(null)}>Cancel</button><button className="btn primary" disabled={busy || !v.valid}>{busy ? "Saving…" : "Save rules"}</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
