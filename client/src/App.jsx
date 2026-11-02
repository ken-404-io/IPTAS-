import { useState } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { getUser, clearSession } from "./api.js";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Employees from "./pages/Employees.jsx";
import TimeLogs from "./pages/TimeLogs.jsx";
import Payroll from "./pages/Payroll.jsx";
import Reports from "./pages/Reports.jsx";
import PayRules from "./pages/PayRules.jsx";
import Users from "./pages/Users.jsx";
import Audit from "./pages/Audit.jsx";
import Settings from "./pages/Settings.jsx";
import Icon from "./components/Icon.jsx";

const NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/employees", label: "Employees", icon: "users" },
  { to: "/time-logs", label: "Time Logs", icon: "clock" },
  { to: "/payroll", label: "Payroll", icon: "wallet" },
  { to: "/reports", label: "Reports", icon: "file" },
  { to: "/pay-rules", label: "Pay Rules", icon: "sliders" },
  { to: "/users", label: "User Accounts", icon: "shield", owner: true },
  { to: "/audit", label: "Audit Trail", icon: "list", owner: true },
  { to: "/settings", label: "Settings", icon: "gear", owner: true },
];

function Shell({ user, onLogout, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shell">
      <aside className={"sidebar" + (open ? " open" : "")}>
        <div className="brand">
          <div className="brand-mark">IP</div>
          <div><div className="brand-name">IPTAS</div><div className="brand-sub">Payroll & Time Tracking</div></div>
        </div>
        <nav>
          {NAV.filter((n) => !n.owner || user.role === "owner").map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <div className="avatar">{user.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</div>
            <div><div className="who-name">{user.full_name}</div><div className="who-role">{user.role === "owner" ? "Business Owner" : "Administrator"}</div></div>
          </div>
          <button className="btn ghost small full" onClick={onLogout}><Icon name="logout" /> Log out</button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <span className="topbar-title">IPTAS</span>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(getUser());
  const nav = useNavigate();
  const logout = () => { clearSession(); setUser(null); nav("/login"); };

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login onLogin={(u) => { setUser(u); nav("/"); }} />} />
      </Routes>
    );
  }
  const owner = user.role === "owner";
  return (
    <Shell user={user} onLogout={logout}>
      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/time-logs" element={<TimeLogs />} />
        <Route path="/payroll" element={<Payroll user={user} />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/pay-rules" element={<PayRules user={user} />} />
        {owner && <Route path="/users" element={<Users user={user} />} />}
        {owner && <Route path="/audit" element={<Audit />} />}
        {owner && <Route path="/settings" element={<Settings />} />}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Shell>
  );
}
