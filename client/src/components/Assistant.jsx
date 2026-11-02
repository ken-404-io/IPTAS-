import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, Children, isValidElement } from "react";
import { useLocation } from "react-router-dom";

// Info messages from the pages are shown by a floating assistant (a circle in the bottom-right corner)
// instead of as boxes in the page. New messages pop open automatically; "OK" hides them until the page
// is refreshed (dismissals are kept in memory only).
const Ctx = createContext(null);

// Plain text of a React node, used to recognise the same message again
export function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf(node.props.children);
  return Children.toArray(node).map(textOf).join("");
}

export function AssistantProvider({ children }) {
  const [msgs, setMsgs] = useState({}); // id -> { text, node }
  const [seen, setSeen] = useState(() => new Set()); // texts dismissed with OK (until refresh)
  const [open, setOpen] = useState(false);
  const register = useCallback((id, text, node) => setMsgs((m) => (m[id]?.text === text ? m : { ...m, [id]: { text, node } })), []);
  const unregister = useCallback((id) => setMsgs((m) => { if (!(id in m)) return m; const n = { ...m }; delete n[id]; return n; }), []);
  const list = Object.entries(msgs);
  const unseen = list.filter(([, v]) => !seen.has(v.text));
  const unseenKey = unseen.map(([, v]) => v.text).join("|");
  useEffect(() => { if (unseen.length) setOpen(true); }, [unseenKey]); // a new message pops the bubble open
  const ok = () => { setSeen((s) => new Set([...s, ...list.map(([, v]) => v.text)])); setOpen(false); };
  const value = useMemo(() => ({ register, unregister }), [register, unregister]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {list.length > 0 && (
        <div className="assistant" aria-live="polite">
          {open && (
            <div className="assistant-bubble" role="dialog" aria-label="IPTAS assistant">
              <div className="assistant-head">
                <span className="assistant-dots" aria-hidden="true"><i /><i /><i /><i /></span>
                <strong>IPTAS Assistant</strong>
                <button type="button" className="assistant-x" onClick={() => setOpen(false)} aria-label="Minimise">–</button>
              </div>
              <div className="assistant-msgs">
                <p className="assistant-hi">Hi! Here {list.length === 1 ? "is something" : "are a few things"} to know on this page:</p>
                {list.map(([id, v], k) => <div key={id} className="assistant-msg" style={{ animationDelay: `${0.12 + k * 0.12}s` }}>{v.node}</div>)}
              </div>
              <div className="assistant-foot"><button type="button" className="btn primary small" onClick={ok} autoFocus>OK</button></div>
            </div>
          )}
          <button type="button" className={"assistant-fab" + (open ? " on" : "")} onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Hide messages" : `Show messages (${list.length})`} title={open ? "Hide messages" : "Messages"}>
            <span className="assistant-dots" aria-hidden="true"><i /><i /><i /><i /></span>
            {!open && unseen.length > 0 && <span className="assistant-badge">{unseen.length}</span>}
          </button>
        </div>
      )}
      <CloseOnRouteChange onChange={() => setOpen(false)} />
    </Ctx.Provider>
  );
}

// Close the bubble when moving to another page (the new page's messages pop it open again)
function CloseOnRouteChange({ onChange }) {
  const { pathname } = useLocation();
  useEffect(() => { onChange(); }, [pathname]);
  return null;
}

// Registers an info message with the assistant while it is rendered. Returns false when there is no assistant.
export function useAssistantMessage(node) {
  const ctx = useContext(Ctx);
  const id = useId();
  const text = textOf(node);
  useEffect(() => {
    if (!ctx || !text) return undefined;
    ctx.register(id, text, node);
    return () => ctx.unregister(id);
  }, [ctx, id, text]);
  return !!ctx;
}
