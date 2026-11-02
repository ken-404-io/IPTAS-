import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader, Alert } from "../components/ui.jsx";

export default function Settings() {
  const [s, setS] = useState(null);
  const [key, setKey] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = () => api("/settings").then(setS).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const save = async (body, note) => {
    setErr(""); setMsg("");
    try { await api("/settings", { method: "PUT", body }); setMsg(note); setKey(""); load(); } catch (e) { setErr(e.message); }
  };
  if (!s) return <div className="loading">Loading…</div>;
  return (
    <>
      <PageHeader title="Settings" subtitle="Business details and the time-tracker connection." />
      <Alert>{err}</Alert><Alert kind="success">{msg}</Alert>
      <div className="grid2">
        <form className="card form" onSubmit={(e) => { e.preventDefault(); save({ company_name: s.company_name, storefront_url: s.storefront_url }, "Business details saved."); }}>
          <h3>Business details</h3>
          <label>Store / company name<input value={s.company_name || ""} onChange={(e) => setS({ ...s, company_name: e.target.value })} /></label>
          <label>Shopify storefront URL<input type="url" value={s.storefront_url || ""} onChange={(e) => setS({ ...s, storefront_url: e.target.value })} placeholder="https://yourstore.myshopify.com" /></label>
          <div className="form-actions"><button className="btn primary">Save</button></div>
        </form>
        <form className="card form" onSubmit={(e) => { e.preventDefault(); save({ clockify_api_key: key }, key ? "Clockify API key saved. Time-log sync now uses Clockify." : "Key removed. Sync uses demo mode."); }}>
          <h3>Time-tracker connection (Clockify)</h3>
          <p className={"conn " + (s.clockify_connected ? "on" : "off")}>{s.clockify_connected ? `Connected · key ${s.clockify_key_hint}${s.clockify_from_env ? " (set on the server)" : ""}` : "Not connected – sync runs in demo mode with sample time logs."}</p>
          {!s.clockify_from_env && (<>
            <label>Clockify API key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste a key from Clockify → Profile settings → API" autoComplete="off" /></label>
            <p className="tiny muted">Employees are matched to Clockify users by their tracker user ID or, if empty, by email address.</p>
            <div className="form-actions">
              {s.clockify_connected && <button type="button" className="btn ghost" onClick={() => save({ clockify_api_key: "" }, "Key removed. Sync uses demo mode.")}>Disconnect</button>}
              <button className="btn primary" disabled={!key}>Save key</button>
            </div>
          </>)}
        </form>
      </div>
    </>
  );
}
