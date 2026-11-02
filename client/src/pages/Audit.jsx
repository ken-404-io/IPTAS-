import { useEffect, useState } from "react";
import { api, fmtDateTime } from "../api.js";
import { PageHeader, Alert, Empty } from "../components/ui.jsx";

function pretty(v) {
  if (!v) return "";
  try { const o = JSON.parse(v); return typeof o === "object" ? Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join(" · ") : String(o); }
  catch { return v; }
}

export default function Audit() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState(""); const [err, setErr] = useState("");
  useEffect(() => { api("/audit").then(setRows).catch((e) => setErr(e.message)); }, []);
  const shown = (rows || []).filter((r) => (r.action + (r.full_name || "") + (r.table_name || "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Audit Trail" subtitle="Who changed what, and when – the latest 300 actions.">
        <input className="search" placeholder="Filter by action or user…" value={q} onChange={(e) => setQ(e.target.value)} />
      </PageHeader>
      <Alert>{err}</Alert>
      <section className="card flush">
        {!rows ? <div className="loading">Loading…</div> : !shown.length ? <Empty>No matching entries.</Empty> : (
          <div className="table-wrap tall"><table>
            <colgroup><col style={{ width: "15%" }} /><col style={{ width: "14%" }} /><col style={{ width: "16%" }} /><col style={{ width: "11%" }} /><col style={{ width: "16%" }} /><col /></colgroup>
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Old value</th><th>New value</th></tr></thead>
            <tbody>{shown.map((a) => (
              <tr key={a.audit_id}><td className="nowrap">{fmtDateTime(a.logged_at)}</td><td>{a.full_name || "System"}</td><td><span className="pill">{a.action}</span></td>
                <td className="tiny">{a.table_name}{a.record_id ? ` #${a.record_id}` : ""}</td><td className="tiny wrap">{pretty(a.old_value)}</td><td className="tiny wrap">{pretty(a.new_value)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
