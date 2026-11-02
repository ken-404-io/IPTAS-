import { useEffect, useState } from "react";
import { api, money, fmtDate } from "../api.js";
import { PageHeader, Modal, Alert, Status, Empty } from "../components/ui.jsx";
import { SkRows } from "../components/Skeleton.jsx";
import Icon from "../components/Icon.jsx";
import { useValidation, FieldError, checkName, checkEmail, checkNumber, checkDate } from "../components/validation.jsx";

const BLANK = { full_name: "", email: "", tracker_user_id: "", employment_type: "hourly", pay_rate: "", currency: "CAD", overtime_eligible: true, status: "active", date_hired: new Date().toISOString().slice(0, 10) };

function EmployeeForm({ initial, others, onSaved, onClose }) {
  const [f, setF] = useState({ ...BLANK, ...initial, tracker_user_id: initial?.tracker_user_id || "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const hourly = f.employment_type === "hourly";
  const v = useValidation(f, (x) => ({
    full_name: checkName(x.full_name, "Full name"),
    email: checkEmail(x.email, others.map((o) => (o.email || "").toLowerCase())),
    pay_rate: checkNumber(x.pay_rate, hourly ? { label: "Hourly rate", min: 0, minExclusive: true, max: 500 } : { label: "Amount per pay period", min: 0, minExclusive: true, max: 100000 }),
    tracker_user_id: !x.tracker_user_id ? "" : /\s/.test(x.tracker_user_id) ? "The tracker user ID cannot contain spaces."
      : x.tracker_user_id.length > 50 ? "The tracker user ID must be 50 characters or fewer."
      : others.some((o) => o.tracker_user_id === x.tracker_user_id) ? "Another employee already has this tracker user ID." : "",
    date_hired: checkDate(x.date_hired, { label: "Date hired" }),
  }));
  const save = async (e) => {
    e.preventDefault(); setErr(""); v.touchAll();
    if (!v.valid) return;
    setBusy(true);
    try {
      const body = { ...f, full_name: f.full_name.trim(), email: f.email.trim(), tracker_user_id: f.tracker_user_id.trim(), pay_rate: Number(f.pay_rate) };
      if (initial?.employee_id) await api(`/employees/${initial.employee_id}`, { method: "PUT", body });
      else await api("/employees", { method: "POST", body });
      onSaved();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="form" noValidate>
      <Alert>{err}</Alert>
      <div className="row2">
        <label>Full name<input value={f.full_name} onChange={set("full_name")} {...v.bind("full_name")} autoFocus /><FieldError name="full_name" msg={v.shown("full_name")} /></label>
        <label>Email<input type="email" value={f.email} onChange={set("email")} {...v.bind("email")} /><FieldError name="email" msg={v.shown("email")} /></label>
      </div>
      <div className="row3">
        <label>Employment type<select value={f.employment_type} onChange={set("employment_type")}><option value="hourly">Hourly</option><option value="fixed">Fixed (per pay period)</option></select></label>
        <label>{hourly ? "Hourly rate" : "Amount per pay period"}<input type="number" min="0" step="0.01" inputMode="decimal" value={f.pay_rate} onChange={set("pay_rate")} {...v.bind("pay_rate")} /><FieldError name="pay_rate" msg={v.shown("pay_rate")} /></label>
        <label>Currency<select value={f.currency} onChange={set("currency")}><option>CAD</option><option>USD</option></select></label>
      </div>
      <div className="row3">
        <label>Time-tracker user ID<input value={f.tracker_user_id} onChange={set("tracker_user_id")} {...v.bind("tracker_user_id")} placeholder="Auto-linked by email" /><FieldError name="tracker_user_id" msg={v.shown("tracker_user_id")} /></label>
        <label>Date hired<input type="date" value={f.date_hired} onChange={set("date_hired")} {...v.bind("date_hired")} /><FieldError name="date_hired" msg={v.shown("date_hired")} /></label>
        <label>Status<select value={f.status} onChange={set("status")}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>
      <label className="check"><input type="checkbox" checked={f.overtime_eligible} onChange={set("overtime_eligible")} /> Eligible for overtime pay</label>
      <p className="tiny muted">CPP and EI are deducted for employees paid in CAD (Canadian payroll). Employees paid in USD have no deductions.</p>
      <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !v.valid}>{busy ? "Saving…" : "Save employee"}</button></div>
    </form>
  );
}

export default function Employees() {
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const load = () => api("/employees").then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const shown = (rows || []).filter((r) => (r.full_name + r.email).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Employee Records" subtitle="Master list of remote workers and their pay rates.">
        <input className="search" placeholder="Search employees…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" /> Add employee</button>
      </PageHeader>
      <Alert>{err}</Alert>
      <section className="card flush">
        {rows && !shown.length ? <Empty>No employees found.</Empty> : (
          <div className="table-wrap"><table>
            <colgroup><col /><col style={{ width: "8%" }} /><col style={{ width: "14%" }} /><col style={{ width: "9%" }} /><col style={{ width: "8%" }} /><col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col style={{ width: "9%" }} /><col style={{ width: "52px" }} /></colgroup>
            <thead><tr><th>Name</th><th>Type</th><th className="num">Pay rate</th><th className="center">Overtime</th><th className="center">CPP / EI</th><th>Tracker ID</th><th>Hired</th><th>Status</th><th /></tr></thead>
            {!rows ? <SkRows rows={7} cols={["two", "text", "num", "center", "center", "text", "text", "pill", "icon"]} /> : <tbody>{shown.map((r) => (
              <tr key={r.employee_id}>
                <td><strong>{r.full_name}</strong><div className="tiny muted">{r.email}</div></td>
                <td>{r.employment_type === "hourly" ? "Hourly" : "Fixed"}</td>
                <td className="num">{money(r.pay_rate, r.currency)}{r.employment_type === "hourly" ? "/h" : "/period"}</td>
                <td className="center">{r.overtime_eligible ? "Yes" : "No"}</td>
                <td className="center">{r.currency === "CAD" ? "Yes" : "No"}</td>
                <td className="tiny">{r.tracker_user_id || <span className="muted">not linked</span>}</td>
                <td className="nowrap">{fmtDate(r.date_hired)}</td>
                <td><Status value={r.status} /></td>
                <td><button className="icon-btn" onClick={() => setEdit(r)} aria-label="Edit"><Icon name="edit" /></button></td>
              </tr>))}
            </tbody>}
          </table></div>
        )}
      </section>
      {edit && (
        <Modal title={edit.employee_id ? "Edit employee" : "Add employee"} onClose={() => setEdit(null)}>
          <EmployeeForm initial={edit} others={(rows || []).filter((r) => r.employee_id !== edit.employee_id)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />
        </Modal>
      )}
    </>
  );
}
