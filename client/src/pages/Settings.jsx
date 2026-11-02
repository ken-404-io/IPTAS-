import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader, Alert } from "../components/ui.jsx";

// Settings are server environment variables (Render → your service → Environment, or .env locally).
// This page shows them, tests the Clockify connection and removes the sample data.
function Connection({ t }) {
  return (
    <div className="form">
      <p className="tiny">Account: <strong>{t.account.name}</strong> ({t.account.email}) · Workspace: <strong>{t.workspace.name}</strong></p>
      {!t.admin_access && <Alert kind="info">This key is not a workspace admin key, so only {t.account.name}'s own hours can be synced. Use a workspace admin's API key to sync the whole team.</Alert>}
      <h4 style={{ margin: "6px 0 0" }}>Clockify users → employees</h4>
      {!t.users.length ? <p className="tiny muted">No users in this workspace.</p> : (
        <ul className="match-list">
          {t.users.map((u) => (
            <li key={u.id}><span>{u.name || u.email}<span className="tiny muted"> {u.email}</span></span>
              {u.employee ? <span className="ok">✓ {u.employee}</span> : <span className="no">No matching employee</span>}</li>
          ))}
        </ul>
      )}
      {t.users.some((u) => !u.employee) && <p className="tiny muted">To match a user, add an employee with the same email address on the Employees page.</p>}
    </div>
  );
}

export default function Settings() {
  const [s, setS] = useState(null);
  const [test, setTest] = useState(null); const [testing, setTesting] = useState(false);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api("/settings").then(setS).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const runTest = async () => {
    setErr(""); setTesting(true);
    try { setTest(await api("/settings/clockify-test", { method: "POST" })); }
    catch (e) { setTest(null); setErr(e.message); } finally { setTesting(false); }
  };
  const clearSample = async () => {
    if (!window.confirm("Remove all sample data? This deletes the sample employees, their hours and payroll history. Your own employees and real data are kept.")) return;
    setErr(""); setMsg("");
    try {
      const r = await api("/settings/clear-sample-data", { method: "POST" });
      setMsg(`Sample data removed: ${r.employees} employees, ${r.time_logs} time entries and ${r.payroll} payroll records.`); load(); setTest(null);
    } catch (e) { setErr(e.message); }
  };
  if (!s) return <div className="loading">{err || "Loading…"}</div>;
  const hasSample = s.sample_data.employees > 0 || s.sample_data.logs > 0;
  const row = (label, value, env) => <li><span>{label}<span className="tiny muted"> <code>{env}</code></span></span><strong>{value}</strong></li>;
  return (
    <>
      <PageHeader title="Settings" subtitle="Server configuration, the Clockify connection and sample data." />
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      <div className="grid2">
        <section className="card">
          <h3>Server configuration</h3>
          <ul className="config-list">
            {row("Company name", s.company_name, "COMPANY_NAME")}
            {row("Shopify storefront", s.storefront_url, "STOREFRONT_URL")}
            {row("Business time zone", s.timezone, "TIMEZONE")}
            {row("USD → CAD rate (last used, else default)", s.fx_rate, "FX_USD_TO_CAD")}
            {row("Sign in with Google", s.google_sign_in ? "On" : "Off", "GOOGLE_CLIENT_ID")}
          </ul>
          <p className="tiny muted">To change these, edit the environment variables on the server (Render → your service → Environment, or the .env file on your PC), then redeploy or restart.</p>
        </section>
        <section className="card form">
          <h3>Time-tracker connection (Clockify)</h3>
          <p className={"conn " + (s.clockify_connected ? "on" : "off")}>{s.clockify_connected
            ? `Connected · key ${s.clockify_key_hint}`
            : s.demo_mode ? "Not connected – sync creates sample hours (demo mode)." : "Not connected."}</p>
          <p className="tiny muted">The API key is set with <code>CLOCKIFY_API_KEY</code>. Use the key of a Clockify workspace admin (Clockify → Profile settings → API → Generate). Employees are matched to Clockify users by tracker user ID, or by email address.</p>
          {s.clockify_connected && <div className="form-actions"><button type="button" className="btn ghost" disabled={testing} onClick={runTest}>{testing ? "Checking…" : "Test connection"}</button></div>}
          {test && <Connection t={test} />}
        </section>
      </div>
      <section className="card">
        <h3>Sample data</h3>
        {hasSample ? (<>
          <p className="muted">IPTAS started with sample employees, hours and payroll history for demonstration ({s.sample_data.employees} sample employees, {s.sample_data.logs} sample time entries). Remove them before running real payroll. Your own employees, user accounts and pay rules are kept.</p>
          <div className="form-actions" style={{ justifyContent: "flex-start" }}><button className="btn danger" onClick={clearSample}>Remove sample data</button></div>
        </>) : <p className="muted">No sample data. All hours come from Clockify.</p>}
      </section>
    </>
  );
}
