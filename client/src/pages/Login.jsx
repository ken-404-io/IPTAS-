import { useEffect, useRef, useState } from "react";
import { api, setSession } from "../api.js";
import { Alert } from "../components/ui.jsx";
import Logo from "../components/Logo.jsx";

// Loads Google's sign-in script once and renders the "Sign in with Google" button
function GoogleButton({ clientId, onCredential }) {
  const box = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google?.accounts?.id || !box.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => onCredential(r.credential) });
      box.current.innerHTML = "";
      window.google.accounts.id.renderButton(box.current, { theme: "outline", size: "large", shape: "pill", text: "signin_with", width: Math.min(332, box.current.offsetWidth || 332) });
    };
    if (window.google?.accounts?.id) render();
    else {
      let s = document.getElementById("gsi-script");
      if (!s) { s = document.createElement("script"); s.id = "gsi-script"; s.src = "https://accounts.google.com/gsi/client"; s.async = true; document.head.appendChild(s); }
      s.addEventListener("load", render);
    }
    return () => { cancelled = true; };
  }, [clientId]);
  return <div className="google-btn" ref={box} />;
}

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleId, setGoogleId] = useState(null);
  useEffect(() => { api("/auth/config").then((c) => setGoogleId(c.google_client_id)).catch(() => {}); }, []);
  const finish = ({ token, user }) => { setSession(token, user); onLogin(user); };
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { finish(await api("/auth/login", { method: "POST", body: { email, password } })); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const google = async (credential) => {
    setErr(""); setBusy(true);
    try { finish(await api("/auth/google", { method: "POST", body: { credential } })); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <div className="login-art">
        <div className="login-art-inner">
          <Logo size={72} />
          <h1>IPTAS</h1>
          <p>Integrated Automated Payroll &amp; Time Tracking Management System</p>
          <ul>
            <li>Time logs synced from Clockify</li>
            <li>Automatic pay, overtime, CPP &amp; EI</li>
            <li>Real-time hours &amp; payroll dashboard</li>
            <li>PDF &amp; Excel payroll reports</li>
          </ul>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo"><Logo size={44} /><span>IPTAS</span></div>
        <h2>Welcome back</h2>
        <p className="muted">Log in to manage payroll.</p>
        <Alert>{err}</Alert>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        <button className="btn primary full" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        {googleId && (<>
          <div className="or"><span>or</span></div>
          <GoogleButton clientId={googleId} onCredential={google} />
        </>)}
        <p className="tiny muted">Accounts are added by the Business Owner or an Administrator under User Accounts. After 5 failed attempts the account is locked for 15 minutes.</p>
      </form>
    </div>
  );
}
