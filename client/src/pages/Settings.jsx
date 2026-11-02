import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader, Alert } from "../components/ui.jsx";

const ZONES = [
  ["America/St_Johns", "Newfoundland (St. John's)"], ["America/Halifax", "Atlantic (Halifax)"], ["America/Toronto", "Eastern (Toronto)"],
  ["America/Winnipeg", "Central (Winnipeg)"], ["America/Regina", "Saskatchewan (Regina)"], ["America/Edmonton", "Mountain (Edmonton)"],
  ["America/Vancouver", "Pacific (Vancouver)"], ["Asia/Manila", "Philippines (Manila)"], ["UTC", "UTC"],
];

function Connection({ t, s, onWorkspace }) {
  return (
    <div className="form">
      <p className="tiny">Account: <strong>{t.account.name}</strong> ({t.account.email})</p>
      {t.workspaces.length > 1 ? (
        <label>Workspace<select value={s.clockify_workspace_id || t.workspace.id} onChange={(e) => onWorkspace(e.target.value)}>
          {t.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select></label>
      ) : <p className="tiny">Workspace: <strong>{t.workspace.name}</strong></p>}
      {!t.admin_access && <Alert kind="info">This key is not a workspace admin key, so only {t.account.name}'s own hours can be synced. Use a workspace admin's API key to sync the whole team.</Alert>}
      <h4 style={{ margin: "6px 0 0" }}>Clockify users → employees</h4>
      <ul className="match-list">
        {t.users.map((u) => (
          <li key={u.id}><span>{u.name || u.email}<span className="tiny muted"> {u.email}</span></span>
            {u.employee ? <span className="ok">✓ {u.employee}</span> : <span className="no">No matching employee</span>}</li>
        ))}
      </ul>
      {t.users.some((u) => !u.employee) && <p className="tiny muted">To match a user, add an employee with the same email address (Employees page), or paste their Clockify user ID ({t.users.find((u) => !u.employee)?.id}) into “Time-tracker user ID”.</p>}
    </div>
  );
}

export default function Settings() {
  const [s, setS] = useState(null);
  const [key, setKey] = useState("");
  const [test, setTest] = useState(null); const [testing, setTesting] = useState(false);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api("/settings").then(setS).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const save = async (body, note) => {
    setErr(""); setMsg("");
    try { await api("/settings", { method: "PUT", body }); setMsg(note); setKey(""); await load(); return true; }
    catch (e) { setErr(e.message); return false; }
  };
  const runTest = async (withKey) => {
    setErr(""); setTesting(true);
    try { setTest(await api("/settings/clockify-test", { method: "POST", body: { key: withKey || "" } })); }
    catch (e) { setTest(null); setErr(e.message); } finally { setTesting(false); }
  };
  const saveKey = async () => {
    setTesting(true);
    const ok = await save({ clockify_api_key: key }, "Clockify API key checked and saved. “Sync time logs” now uses real Clockify hours.");
    setTesting(false);
    if (ok) runTest();
  };
  const clearSample = async () => {
    if (!window.confirm("Remove all sample data? This deletes the sample employees, their hours and payroll history, and turns off demo mode. Your own employees and real data are kept.")) return;
    setErr(""); setMsg("");
    try {
      const r = await api("/settings/clear-sample-data", { method: "POST" });
      setMsg(`Sample data removed: ${r.employees} employees, ${r.time_logs} time entries and ${r.payroll} payroll records.`); load(); setTest(null);
    } catch (e) { setErr(e.message); }
  };
  if (!s) return <div className="loading">Loading…</div>;
  const hasSample = s.sample_data.employees > 0 || s.sample_data.logs > 0;
  return (
    <>
      <PageHeader title="Settings" subtitle="Business details, the Clockify connection and sample data." />
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      <div className="grid2">
        <form className="card form" onSubmit={(e) => { e.preventDefault(); save({ company_name: s.company_name, storefront_url: s.storefront_url, timezone: s.timezone }, "Business details saved."); }}>
          <h3>Business details</h3>
          <label>Store / company name<input value={s.company_name || ""} onChange={(e) => setS({ ...s, company_name: e.target.value })} /></label>
          <label>Shopify storefront URL<input type="url" value={s.storefront_url || ""} onChange={(e) => setS({ ...s, storefront_url: e.target.value })} placeholder="https://yourstore.myshopify.com" /></label>
          <label>Business time zone<select value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })}>
            {(ZONES.some(([z]) => z === s.timezone) ? ZONES : [[s.timezone, s.timezone], ...ZONES]).map(([z, n]) => <option key={z} value={z}>{n}</option>)}
          </select></label>
          <p className="tiny muted">Clockify hours are put on the work date in this time zone, so a late-evening shift stays on the right day.</p>
          <div className="form-actions"><button className="btn primary">Save</button></div>
        </form>
        <div className="card form">
          <h3>Time-tracker connection (Clockify)</h3>
          <p className={"conn " + (s.clockify_connected ? "on" : "off")}>{s.clockify_connected
            ? `Connected · key ${s.clockify_key_hint}${s.clockify_from_env ? " (set on the server)" : ""}`
            : s.demo_mode ? "Not connected – sync creates sample hours (demo mode)." : "Not connected – connect Clockify to sync hours."}</p>
          {!s.clockify_from_env && (<>
            <label>Clockify API key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Clockify → Profile settings → API → Generate" autoComplete="off" /></label>
            <p className="tiny muted">Use the API key of a Clockify workspace admin so everyone's hours can be read. Employees are matched to Clockify users by tracker user ID, or by email address.</p>
          </>)}
          <div className="form-actions">
            {s.clockify_connected && !s.clockify_from_env && <button type="button" className="btn ghost" onClick={() => { setTest(null); save({ clockify_api_key: "" }, "Clockify disconnected."); }}>Disconnect</button>}
            {(s.clockify_connected || key) && <button type="button" className="btn ghost" disabled={testing} onClick={() => runTest(key)}>{testing ? "Checking…" : "Test connection"}</button>}
            {!s.clockify_from_env && <button type="button" className="btn primary" disabled={!key || testing} onClick={saveKey}>Save key</button>}
          </div>
          {test && <Connection t={test} s={s} onWorkspace={async (id) => { if (await save({ clockify_workspace_id: id }, "Workspace saved.")) runTest(); }} />}
        </div>
      </div>
      <section className="card">
        <h3>Sample data</h3>
        {hasSample || s.demo_mode ? (<>
          <p className="muted">IPTAS started with sample employees, hours and payroll history for demonstration ({s.sample_data.employees} sample employees, {s.sample_data.logs} sample time entries). Remove them before running real payroll. Your own employees, user accounts, pay rules and settings are kept.</p>
          <div className="form-actions" style={{ justifyContent: "flex-start" }}><button className="btn danger" onClick={clearSample}>Remove sample data</button></div>
        </>) : <p className="muted">No sample data. {s.demo_mode ? "" : "Demo mode is off, so all hours come from Clockify or manual entries."}</p>}
      </section>
    </>
  );
}
