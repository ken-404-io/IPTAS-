import { useEffect, useState } from "react";
import { api, fmtDate } from "../api.js";
import { PageHeader, Alert, Modal } from "../components/ui.jsx";
import { Sk } from "../components/Skeleton.jsx";
import Icon from "../components/Icon.jsx";
import { useValidation, FieldError, PasswordChecklist, checkName, checkEmail, checkPassword } from "../components/validation.jsx";

const BLANK = { full_name: "", email: "", password: "", role: "admin" };

function AddUser({ taken, onClose, onCreated }) {
  const [f, setF] = useState(BLANK);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const v = useValidation(f, (x) => ({ full_name: checkName(x.full_name, "Full name"), email: checkEmail(x.email, taken), password: checkPassword(x.password) }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(""); v.touchAll();
    if (!v.valid) return;
    setBusy(true);
    try { await api("/users", { method: "POST", body: { ...f, full_name: f.full_name.trim(), email: f.email.trim() } }); onCreated(f.email.trim()); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      <Alert>{err}</Alert>
      <label>Full name<input value={f.full_name} onChange={set("full_name")} {...v.bind("full_name")} autoFocus /><FieldError name="full_name" msg={v.shown("full_name")} /></label>
      <label>Email<input type="email" value={f.email} onChange={set("email")} {...v.bind("email")} /><FieldError name="email" msg={v.shown("email")} /></label>
      <div className="row2">
        <label>Temporary password<input type="text" value={f.password} onChange={set("password")} {...v.bind("password")} autoComplete="off" />
          <PasswordChecklist value={f.password} /></label>
        <label>Role<select value={f.role} onChange={set("role")}><option value="admin">Administrator</option><option value="owner">Business Owner</option></select></label>
      </div>
      <p className="tiny muted">Share the temporary password with the person. They can also use “Sign in with Google” if this email is their Google account.</p>
      <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !v.valid}>{busy ? "Creating…" : "Create account"}</button></div>
    </form>
  );
}

function ResetPassword({ user, onClose, onDone }) {
  const [f, setF] = useState({ password: "", confirm: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const v = useValidation(f, (x) => ({ password: checkPassword(x.password), confirm: !x.confirm ? "Type the password again." : x.confirm !== x.password ? "The passwords do not match." : "" }));
  const submit = async (e) => {
    e.preventDefault(); setErr(""); v.touchAll();
    if (!v.valid) return;
    setBusy(true);
    try { await api(`/users/${user.user_id}`, { method: "PUT", body: { password: f.password } }); onDone(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      <Alert>{err}</Alert>
      <label>New password<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} {...v.bind("password")} autoComplete="new-password" autoFocus />
        <PasswordChecklist value={f.password} /></label>
      <label>Confirm password<input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} {...v.bind("confirm")} autoComplete="new-password" /><FieldError name="confirm" msg={v.shown("confirm")} /></label>
      <div className="form-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !v.valid}>{busy ? "Saving…" : "Reset password"}</button></div>
    </form>
  );
}

export default function Users({ user }) {
  const [rows, setRows] = useState(null);
  const [add, setAdd] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api("/users").then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const update = async (u, body, note) => {
    setErr(""); setMsg("");
    try { await api(`/users/${u.user_id}`, { method: "PUT", body }); setMsg(note); load(); } catch (e2) { setErr(e2.message); }
  };
  const reset = (u) => { setErr(""); setMsg(""); setResetting(u); };
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
          <AddUser taken={(rows || []).map((u) => u.email.toLowerCase())} onClose={() => setAdd(false)}
            onCreated={(email) => { setAdd(false); setMsg(`Account created for ${email}.`); load(); }} />
        </Modal>
      )}
      {resetting && (
        <Modal title={`Reset password – ${resetting.full_name}`} onClose={() => setResetting(null)}>
          <ResetPassword user={resetting} onClose={() => setResetting(null)} onDone={() => { setMsg(`Password reset for ${resetting.full_name}.`); setResetting(null); }} />
        </Modal>
      )}
    </>
  );
}
