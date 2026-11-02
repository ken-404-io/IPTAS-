import { useEffect, useState } from "react";
import { api, fmtDate } from "../api.js";
import { PageHeader, Alert, Modal, Status } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

export default function Users({ user }) {
  const [rows, setRows] = useState([]);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", password: "", role: "admin" });
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api("/users").then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const create = async (e) => {
    e.preventDefault(); setErr("");
    try { await api("/users", { method: "POST", body: f }); setAdd(false); setMsg(`Account created for ${f.email}.`); setF({ full_name: "", email: "", password: "", role: "admin" }); load(); }
    catch (e2) { setErr(e2.message); }
  };
  const update = async (u, body, note) => {
    setErr(""); setMsg("");
    try { await api(`/users/${u.user_id}`, { method: "PUT", body }); setMsg(note); load(); } catch (e2) { setErr(e2.message); }
  };
  const reset = (u) => {
    const pw = window.prompt(`New password for ${u.full_name} (at least 8 characters):`);
    if (pw) update(u, { password: pw }, "Password reset.");
  };
  return (
    <>
      <PageHeader title="User Accounts & Roles" subtitle="Who can log in to IPTAS and what they can do.">
        <button className="btn primary" onClick={() => setAdd(true)}><Icon name="plus" /> Add user</button>
      </PageHeader>
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      <section className="card flush"><div className="table-wrap"><table>
        <colgroup><col style={{ width: "20%" }} /><col /><col style={{ width: "15%" }} /><col style={{ width: "10%" }} /><col style={{ width: "13%" }} /><col style={{ width: "24%" }} /></colgroup>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={u.user_id}>
            <td><strong>{u.full_name}</strong>{u.user_id === user.user_id && <span className="tiny muted"> (you)</span>}</td>
            <td>{u.email}</td>
            <td>{u.role === "owner" ? "Business Owner" : "Administrator"}</td>
            <td><Status value={u.status} /></td>
            <td>{fmtDate(u.created_at)}</td>
            <td className="btn-row">
              {u.user_id !== user.user_id && <button className="btn ghost small" onClick={() => update(u, { status: u.status === "active" ? "inactive" : "active" }, `${u.full_name} is now ${u.status === "active" ? "inactive" : "active"}.`)}>{u.status === "active" ? "Deactivate" : "Activate"}</button>}
              <button className="btn ghost small" onClick={() => reset(u)}>Reset password</button>
            </td>
          </tr>))}</tbody>
      </table></div></section>
      <section className="card">
        <h3>Role permissions</h3>
        <div className="table-wrap"><table className="perm">
          <colgroup><col /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /></colgroup>
          <thead><tr><th>Function</th><th>Administrator</th><th>Business Owner</th></tr></thead>
          <tbody>
            {[["Employee records, time-log sync, compute payroll, dashboard, reports", true, true], ["Configure pay rules", false, true], ["Approve payroll", false, true], ["Manage user accounts", false, true], ["View audit trail & settings", false, true]]
              .map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b ? "✓" : "–"}</td><td>{c ? "✓" : "–"}</td></tr>)}
          </tbody>
        </table></div>
      </section>
      {add && (
        <Modal title="Add user" onClose={() => setAdd(false)}>
          <form className="form" onSubmit={create}>
            <label>Full name<input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required /></label>
            <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
            <div className="row2">
              <label>Temporary password<input type="text" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
              <label>Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Administrator</option><option value="owner">Business Owner</option></select></label>
            </div>
            <p className="tiny muted">Share the temporary password with the person. They can also use “Sign in with Google” if this email is their Google account.</p>
            <Alert>{err}</Alert>
            <div className="form-actions"><button type="button" className="btn ghost" onClick={() => setAdd(false)}>Cancel</button><button className="btn primary">Create account</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
