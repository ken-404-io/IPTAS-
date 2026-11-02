import { useEffect } from "react";
import Icon from "./Icon.jsx";
import { useAssistantMessage } from "./Assistant.jsx";
import { Sk } from "./Skeleton.jsx";

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Alert({ kind = "error", children }) {
  // Info messages go to the floating assistant (when the page has one); errors and successes stay inline
  const toAssistant = useAssistantMessage(kind === "info" ? children : null);
  if (!children || (kind === "info" && toAssistant)) return null;
  return <div className={"alert " + kind}>{children}</div>;
}

export function Status({ value }) {
  const map = { open: "Open", computed: "Computed – awaiting approval", approved: "Approved", active: "Active", inactive: "Inactive" };
  return <span className={"badge " + value}>{map[value] || value}</span>;
}

export function Empty({ children }) { return <div className="empty">{children}</div>; }

export function PeriodSelect({ periods, value, onChange }) {
  if (!periods.length) return <Sk w={240} h={40} r={10} className="sk-select" />; // still loading
  return (
    <select value={value || ""} onChange={(e) => onChange(Number(e.target.value))} aria-label="Pay period">
      {periods.map((p) => (
        <option key={p.period_id} value={p.period_id}>
          {p.start_date} to {p.end_date} · {p.status}
        </option>
      ))}
    </select>
  );
}
