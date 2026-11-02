import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, money, hrs, periodLabel, fmtDate, fmtDateTime } from "../api.js";
import { PageHeader, Alert, Status } from "../components/ui.jsx";
import { Sk, SkHeader, SkStat } from "../components/Skeleton.jsx";
import Icon from "../components/Icon.jsx";

function BarList({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.hours));
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div className="barrow" key={r.name}>
          <span className="barname">{r.name}</span>
          <div className="bartrack">
            <div className="bar" style={{ width: `${(r.hours / max) * 100}%` }} />
            {r.overtime > 0 && <div className="bar ot" style={{ width: `${(r.overtime / max) * 100}%` }} />}
          </div>
          <span className="barval">{hrs(r.hours)} h</span>
        </div>
      ))}
    </div>
  );
}

function History({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.gross_cad));
  return (
    <div className="colchart">
      {rows.map((r) => (
        <div className="col" key={r.period_id} title={`${periodLabel(r)}: ${money(r.gross_cad)}`}>
          <span className="colval">{r.gross_cad ? "$" + Math.round(r.gross_cad / 100) / 10 + "k" : "–"}</span>
          <div className={"colbar " + r.status} style={{ height: `${(r.gross_cad / max) * 140 + 2}px` }} />
          <span className="collab">{fmtDate(r.start_date).replace(/, \d{4}/, "")}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ user }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/dashboard").then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <Alert>{err}</Alert>;
  if (!d) return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <SkHeader actions={2} />
      <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi sk-tile"><SkStat /></div>)}</div>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><Sk w={190} h={16} /><Sk w={120} h={10} /></div>
          <div className="barlist">{[92, 88, 85, 80, 78, 70, 66, 60].map((w, i) => (
            <div className="barrow" key={i}><Sk w="80%" h={12} /><Sk w={`${w}%`} h={14} r={999} /><Sk w={40} h={12} style={{ marginLeft: "auto" }} /></div>))}</div>
        </section>
        <section className="card">
          <div className="card-head"><Sk w={200} h={16} /><Sk w={140} h={10} /></div>
          <div className="colchart">{[70, 95, 40].map((h, i) => <div className="col" key={i}><Sk w={34} h={10} /><Sk w="100%" h={h * 1.4} r={8} style={{ maxWidth: 46 }} /><Sk w={40} h={10} /></div>)}</div>
          <div className="sync-note"><Sk w="70%" h={11} /></div>
        </section>
      </div>
      <section className="card rules-strip">{[0, 1, 2, 3, 4].map((i) => <SkStat key={i} big={16} sub={false} />)}</section>
    </div>
  );
  const t = d.totals;
  return (
    <>
      <PageHeader title={`Hello, ${user.full_name.split(" ")[0]}`} subtitle={`${d.company_name || "Your store"} · Current pay period ${periodLabel(d.period)}`}>
        {d.storefront_url && <a className="btn ghost" href={d.storefront_url} target="_blank" rel="noreferrer"><Icon name="store" /> Shopify storefront</a>}
        <Link className="btn primary" to="/payroll"><Icon name="wallet" /> Go to payroll</Link>
      </PageHeader>
      {t.pending_approval > 0 && user.role === "owner" && (
        <Alert kind="info">{t.pending_approval} payroll{t.pending_approval > 1 ? "s are" : " is"} computed and waiting for your approval. <Link to="/payroll">Review now →</Link></Alert>
      )}
      <div className="kpis">
        <div className="kpi"><span>Hours this period</span><strong>{hrs(t.hours)}</strong><small>{hrs(t.overtime)} overtime hours</small></div>
        <div className="kpi accent"><span>Projected payroll cost</span><strong>{money(t.projected_cad)}</strong><small>Gross, in CAD</small></div>
        <div className="kpi"><span>Active employees</span><strong>{t.employees}</strong><small>Remote team</small></div>
        <div className="kpi"><span>Pay date</span><strong>{fmtDate(d.period.pay_date)}</strong><small><Status value={d.period.status} /></small></div>
      </div>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><h3>Hours worked – current period</h3><span className="legend"><i className="lg reg" /> Regular <i className="lg ot" /> Overtime</span></div>
          <BarList rows={d.per_employee} />
        </section>
        <section className="card">
          <div className="card-head"><h3>Payroll cost by period (CAD)</h3><span className="legend"><i className="lg ap" /> Approved <i className="lg op" /> Not yet approved</span></div>
          <History rows={d.history} />
          <div className="sync-note">
            <Icon name="sync" />
            {d.last_sync ? <>Last time-log sync: {fmtDateTime(d.last_sync.at)} ({d.last_sync.mode === "clockify" ? "Clockify" : "demo mode"}, {d.last_sync.synced} entries)</> : "Time logs have not been synced yet."}
          </div>
        </section>
      </div>
      <section className="card rules-strip">
        <div><span className="muted">Pay rules in effect</span><strong>{d.rule.rule_name}</strong></div>
        <div><span className="muted">Overtime</span><strong>after {hrs(d.rule.overtime_threshold)} h/day × {d.rule.overtime_multiplier}</strong></div>
        <div><span className="muted">CPP</span><strong>{(d.rule.cpp_rate * 100).toFixed(2)}%</strong></div>
        <div><span className="muted">EI</span><strong>{(d.rule.ei_rate * 100).toFixed(2)}%</strong></div>
        <div><span className="muted">USD → CAD</span><strong>{d.fx_rate}</strong></div>
      </section>
    </>
  );
}
