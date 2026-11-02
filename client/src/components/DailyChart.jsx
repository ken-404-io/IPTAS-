import { useState } from "react";
import { hrs } from "../api.js";

// Hours per day for one employee: stacked columns (regular below, overtime above) for every day of the
// pay period, with the daily overtime threshold drawn as a reference line. Colors validated for
// color-vision deficiency (blue / orange); identity is also given by the legend and the tooltip.
export const REG_COLOR = "#2a78d6";
export const OT_COLOR = "#eb6834";

const W = 500, H = 200, PAD_L = 28, PAD_R = 34, PAD_T = 10, PAD_B = 38;
const COL_MAX = 24;
const R = 4; // rounded data end

function niceMax(v, threshold) {
  const top = Math.max(v, threshold * 1.5, 1);
  const step = top <= 12 ? 3 : top <= 24 ? 6 : 12;
  return { max: Math.ceil(top / step) * step, step };
}

// Column path: rounded top corners only, square at the baseline
function columnPath(x, y, w, h, roundTop) {
  if (h <= 0) return "";
  const r = roundTop ? Math.min(R, h, w / 2) : 0;
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

export function scaleFor(rows, threshold) {
  return niceMax(Math.max(0, ...rows.map((d) => d.hours)), threshold);
}

export default function DailyChart({ name, dates, byDate, threshold, scale, onPick, selected }) {
  const [hover, setHover] = useState(null);
  const { max, step } = scale;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const slot = plotW / dates.length;
  const colW = Math.min(COL_MAX, slot * 0.6);
  const y = (v) => PAD_T + plotH - (v / max) * plotH;
  const ticks = []; for (let t = 0; t <= max + 1e-9; t += step) ticks.push(t);
  const total = dates.reduce((a, d) => a + (byDate[d]?.hours || 0), 0);
  const ot = dates.reduce((a, d) => a + (byDate[d]?.overtime || 0), 0);
  const h = hover != null ? byDate[dates[hover]] : null;

  return (
    <figure className="daily-chart">
      <figcaption>
        <strong>{name}</strong>
        <span className="tiny muted">{hrs(total)} h total · {hrs(total - ot)} regular · {hrs(ot)} overtime</span>
      </figcaption>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Hours per day for ${name}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
              <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
            </g>
          ))}
          <line x1={PAD_L} x2={W - PAD_R} y1={y(threshold)} y2={y(threshold)} className="limit" />
          <text x={W - PAD_R + 6} y={y(threshold) + 4} className="tick">{hrs(threshold)} h</text>
          {dates.map((d, i) => {
            const row = byDate[d];
            const x = PAD_L + i * slot + (slot - colW) / 2;
            const reg = row?.regular || 0, over = row?.overtime || 0;
            const regTop = y(reg), regH = y(0) - regTop;
            const otH = y(reg) - y(reg + over);
            const gap = over > 0 && regH > 0 ? 2 : 0; // surface gap between stacked segments
            const day = new Date(d + "T00:00:00");
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <g key={d}>
                {regH > 0 && <path d={columnPath(x, regTop, colW, regH, over <= 0)} fill={REG_COLOR} />}
                {otH > gap && <path d={columnPath(x, y(reg + over), colW, otH - gap, true)} fill={OT_COLOR} />}
                <text x={x + colW / 2} y={H - PAD_B + 16} textAnchor="middle" className={"tick" + (weekend ? " weekend" : "")}>{day.getDate()}</text>
                <text x={x + colW / 2} y={H - PAD_B + 29} textAnchor="middle" className={"tick small" + (weekend ? " weekend" : "")}>
                  {day.toLocaleDateString("en-CA", { weekday: "short" }).slice(0, 2)}</text>
                {/* hit target: the whole day slot, bigger than the mark */}
                <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH + 34} className={"hit" + (hover === i ? " on" : "") + (selected === d ? " sel" : "")}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  onClick={() => row && onPick?.(row)} tabIndex={row ? 0 : -1}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && row && onPick?.(row)}
                  style={{ cursor: row ? "pointer" : "default" }} aria-label={`${d}: ${row ? hrs(row.hours) : 0} hours`} />
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div className="chart-tip" style={{
            left: `${((PAD_L + (hover + 0.5) * slot) / W) * 100}%`,
            // keep the tooltip inside the chart near the edges
            transform: hover < dates.length * 0.25 ? "translateX(-15%)" : hover > dates.length * 0.75 ? "translateX(-85%)" : "translateX(-50%)",
          }}>
            <strong>{new Date(dates[hover] + "T00:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}</strong>
            {h ? (<>
              <div><i style={{ background: REG_COLOR }} />Regular <b>{hrs(h.regular)} h</b></div>
              <div><i style={{ background: OT_COLOR }} />Overtime <b>{hrs(h.overtime)} h</b></div>
              <div className="tip-total">Total <b>{hrs(h.hours)} h</b></div>
              {selected !== dates[hover] && <div className="tiny muted">Click to show this day</div>}
            </>) : <div className="muted">No hours</div>}
          </div>
        )}
      </div>
    </figure>
  );
}
