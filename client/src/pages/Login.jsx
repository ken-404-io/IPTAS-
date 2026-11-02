import { useState } from "react";
import { api, setSession } from "../api.js";
import { Alert } from "../components/ui.jsx";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const { token, user } = await api("/auth/login", { method: "POST", body: { email, password } });
      setSession(token, user); onLogin(user);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="deco chev">›››› </div>
        <div className="login-art-inner">
          <div className="brand-mark big">IP</div>
          <h1>IPTAS</h1>
          <p>Integrated Automated Payroll &amp; Time Tracking Management System</p>
          <ul>
            <li>Time logs synced from your time-tracker</li>
            <li>Automatic pay, overtime, CPP &amp; EI</li>
            <li>Real-time hours &amp; payroll dashboard</li>
            <li>PDF &amp; Excel payroll reports</li>
          </ul>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>Welcome back</h2>
        <p className="muted">Log in to manage payroll.</p>
        <Alert>{err}</Alert>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        <button className="btn primary full" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        <p className="tiny muted">Accounts are created by the Business Owner. After 5 failed attempts the account is locked for 15 minutes.</p>
      </form>
    </div>
  );
}
