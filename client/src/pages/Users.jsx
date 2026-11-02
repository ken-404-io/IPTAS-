import { useEffect, useState } from "react";
import { api, fmtDate } from "../api.js";
import { PageHeader, Alert, Modal } from "../components/ui.jsx";
import { Sk } from "../components/Skeleton.jsx";
import Icon from "../components/Icon.jsx";

export default function Users({ user }) {
  const [rows, setRows] = useState(null);
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
  const initials = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const toggleActive = (u) => update(u, { status: u.status === "active" ? "inactive" : "active" }, `${u.full_name} is now ${u.status === "active" ? "inactive" : "active"}.`);
  return (
    <>
      <PageHeader title="User Accounts" subtitle="Who can log in to IPTAS.">
        <button className="btn primary" onClick={() => setAdd(true)}><Icon name="plus" /> Add user</button>
      </PageHeader>
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      <section className="card flush">
        <ul className="user-list">
          {!rows && [0, 1, 2].map((i) => (
            <li key={i} aria-hidden="true">
              <Sk w={36} h={36} r={999} />
              <span className="who-cell"><Sk w="40%" h={13} /><Sk w="55%" h={10} style={{ flexBasis: "100%" }} /></span>
              <Sk w="70%" h={12} /><Sk w={60} h={12} /><span className="row-actions"><Sk w={100} h={12} /><Sk w={70} h={12} /></span>
            </li>
          ))}
          {(rows || []).map((u) => (
            <li key={u.user_id} className={u.status !== "active" ? "off" : ""} title={`Created ${fmtDate(u.created_at)}`}>
              <span className="avatar-sm">{initials(u.full_name)}</span>
              <span className="who-cell"><strong>{u.full_name}</strong>{u.user_id === user.user_id && <span className="you">You</span>}<span className="tiny muted">{u.email}</span></span>
              <span className="role-cell">{u.role === "owner" ? "Business Owner" : "Administrator"}</span>
              <span className={"dot-status " + u.status}>{u.status === "active" ? "Active" : "Inactive"}</span>
              <span className="row-actions">
                <button className="text-btn" onClick={() => reset(u)}>Reset password</button>
                {u.user_id !== user.user_id && <button className={"text-btn" + (u.status === "active" ? " danger" : "")} onClick={() => toggleActive(u)}>{u.status === "active" ? "Deactivate" : "Activate"}</button>}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <details className="card how">
        <summary>What each role can do</summary>
        <ul>
          <li><strong>Administrator</strong> – employees, time logs, compute payroll, dashboard and reports.</li>
          <li><strong>Business Owner</strong> – everything above, plus pay rules, approving payroll, user accounts, audit trail and settings.</li>
        </ul>
        <p className="tiny muted">Deactivated accounts are signed out right away and cannot log in.</p>
      </details>
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
