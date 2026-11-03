import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader, Alert } from "../components/ui.jsx";
import { Sk } from "../components/Skeleton.jsx";

// Settings are server environment variables (Render → your service → Environment, or .env locally).
// This page shows them, tests the Clockify connection and removes the sample data.
function Connection({ t }) {
  return (
    <div className="conn-result">
      <p className="tiny muted">{t.account.name} ({t.account.email}) · workspace <strong>{t.workspace.name}</strong></p>
      {!t.admin_access && <Alert kind="info">This key is not a workspace admin key, so only {t.account.name}'s own hours can be synced.</Alert>}
      {!t.users.length ? <p className="tiny muted">No users in this workspace.</p> : (
        <ul className="match-list">
          {t.users.map((u) => (
            <li key={u.id}><span>{u.name || u.email}<span className="tiny muted"> {u.email}</span></span>
              {u.employee ? <span className="ok">✓ {u.employee}</span> : <span className="no">Not matched</span>}</li>
          ))}
        </ul>
      )}
      {t.users.some((u) => !u.employee) && <p className="tiny muted">To match someone, add an employee with the same email on the Employees page.</p>}
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
  if (!s) return (
    <>
      <PageHeader title="Settings" subtitle="Configured on the server." />
      <Alert>{err}</Alert>
      {!err && (<div aria-busy="true" aria-label="Loading settings">
        <section className="card"><div className="set-head"><Sk w={80} h={16} /><Sk w={190} h={12} /></div></section>
        <section className="card"><Sk w={90} h={16} style={{ marginBottom: 16 }} />
          <div className="kv">{[0, 1, 2, 3, 4].map((i) => <div key={i}><Sk w={90} h={12} /><Sk w={[160, 200, 130, 50, 40][i]} h={12} /></div>)}</div>
        </section>
      </div>)}
    </>
  );
  const hasSample = s.sample_data.employees > 0 || s.sample_data.logs > 0;
  const rows = [
    ["Company", s.company_name, "COMPANY_NAME"],
    ["Storefront", s.storefront_url, "STOREFRONT_URL"],
    ["Time zone", s.timezone, "TIMEZONE"],
    ["USD → CAD", s.fx_rate, "FX_USD_TO_CAD"],
    ["Google sign-in", s.google_sign_in ? "On" : "Off", "GOOGLE_CLIENT_ID"],
    ["PayPal payouts", s.paypal ? (s.paypal === "sandbox" ? "Connected · sandbox" : "Connected · live") : "Off", "PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV"],
  ];
  return (
    <>
      <PageHeader title="Settings" subtitle="Configured on the server." />
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>

      <section className="card">
        <div className="set-head">
          <h3>Clockify</h3>
          <span className={"dot-status " + (s.clockify_connected ? "active" : "inactive")}>
            {s.clockify_connected ? `Connected · ${s.clockify_key_hint}` : s.demo_mode ? "Not connected (demo mode)" : "Not connected"}</span>
          {s.clockify_connected && <button className="text-btn" disabled={testing} onClick={runTest}>{testing ? "Checking…" : "Test connection"}</button>}
        </div>
        {test && <Connection t={test} />}
      </section>

      <section className="card">
        <h3>Business</h3>
        <dl className="kv">
          {rows.map(([k, v, env]) => <div key={k} title={`Set with ${env}`}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </section>

      {hasSample && (
        <section className="card set-head sample">
          <span><strong>Sample data</strong><span className="tiny muted"> · {s.sample_data.employees} employees, {s.sample_data.logs} time entries</span></span>
          <button className="btn danger small" onClick={clearSample}>Remove sample data</button>
        </section>
      )}

      <details className="card how">
        <summary>How to change these</summary>
        <p className="tiny muted">Edit the environment variables on the server (Render → your service → Environment, or the .env file on your PC), then redeploy or restart.</p>
        <ul className="env-list">
          <li><code>CLOCKIFY_API_KEY</code> Clockify workspace admin key (Profile settings → API → Generate)</li>
          {rows.map(([k, , env]) => <li key={env}><code>{env}</code> {k}</li>)}
        </ul>
      </details>
    </>
  );
}
