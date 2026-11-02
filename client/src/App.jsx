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
import Logo from "./components/Logo.jsx";
import { AssistantProvider } from "./components/Assistant.jsx";

// Sidebar items in labelled sections; "owner" items are only shown to the Business Owner
const NAV = [
  { items: [{ to: "/", label: "Dashboard", icon: "dashboard", end: true }] },
  { title: "Track", items: [{ to: "/time-logs", label: "Time Logs", icon: "clock" }] },
  { title: "Payroll", items: [
    { to: "/payroll", label: "Payroll", icon: "wallet" },
    { to: "/reports", label: "Reports", icon: "file" },
    { to: "/pay-rules", label: "Pay Rules", icon: "sliders" },
  ] },
  { title: "Manage", items: [
    { to: "/employees", label: "Employees", icon: "users" },
    { to: "/users", label: "User Accounts", icon: "shield", owner: true },
    { to: "/audit", label: "Audit Trail", icon: "list", owner: true },
    { to: "/settings", label: "Settings", icon: "gear", owner: true },
  ] },
];

const COLLAPSE_KEY = "iptas_nav_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

function Shell({ user, onLogout, children }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* storage unavailable */ } return !c; });
  const initials = user.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("");
  return (
    <div className={"shell" + (collapsed ? " nav-collapsed" : "")}>
      <aside className={"sidebar" + (open ? " open" : "")}>
        <div className="brand">
          <Logo size={36} />
          <div className="brand-text"><div className="brand-name">IPTAS</div><div className="brand-sub">Payroll & Time Tracking</div></div>
        </div>
        <button type="button" className="nav-toggle" onClick={toggle} aria-label={collapsed ? "Expand menu" : "Collapse menu"} title={collapsed ? "Expand menu" : "Collapse menu"}>
          <Icon name={collapsed ? "chevrons-right" : "chevrons-left"} size={16} />
        </button>
        <nav>
          {NAV.map((sec, i) => {
            const items = sec.items.filter((n) => !n.owner || user.role === "owner");
            if (!items.length) return null;
            return (
              <div className="nav-section" key={i}>
                {sec.title && <div className="nav-title">{sec.title}</div>}
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} title={collapsed ? n.label : undefined}
                    className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
                    <Icon name={n.icon} size={20} /> <span className="nav-label">{n.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="who" title={collapsed ? `${user.full_name} – ${user.role === "owner" ? "Business Owner" : "Administrator"}` : undefined}>
            <div className="avatar">{initials}</div>
            <div className="who-text"><div className="who-name">{user.full_name}</div><div className="who-role">{user.role === "owner" ? "Business Owner" : "Administrator"}</div></div>
          </div>
          <button className="nav-link logout" onClick={onLogout} title={collapsed ? "Log out" : undefined}><Icon name="logout" size={20} /> <span className="nav-label">Log out</span></button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <span className="topbar-title">IPTAS</span>
        </header>
        <AssistantProvider><div className="content">{children}</div></AssistantProvider>
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
