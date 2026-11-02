// Loading placeholders shaped like the real content, so the page does not jump when data arrives.
export function Sk({ w = "100%", h = 12, r = 6, className = "", style }) {
  return <span className={"sk " + className} style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

// Table body placeholder: `cols` describes each column, e.g. "text", "two" (name + email), "num", "pill", "center", "icon"
export function SkRows({ cols, rows = 6 }) {
  const widths = [72, 58, 84, 64, 76, 52]; // vary lengths so rows look natural
  return (
    <tbody className="sk-body" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {cols.map((c, i) => {
            const w = widths[(r + i) % widths.length];
            if (c === "two") return <td key={i}><Sk w={`${w + 10}%`} h={13} /><Sk w={`${w}%`} h={10} style={{ marginTop: 7 }} /></td>;
            if (c === "num") return <td key={i} className="num"><Sk w={`${Math.max(36, w - 20)}%`} style={{ marginLeft: "auto" }} /></td>;
            if (c === "center") return <td key={i} className="center"><Sk w={28} style={{ margin: "0 auto" }} /></td>;
            if (c === "pill") return <td key={i}><Sk w={58} h={20} r={999} /></td>;
            if (c === "icon") return <td key={i}><Sk w={18} h={18} r={5} /></td>;
            if (c === "lines") return <td key={i}><Sk w={`${w}%`} h={10} /><Sk w={`${w - 18}%`} h={10} style={{ marginTop: 6 }} /></td>;
            return <td key={i}><Sk w={`${w}%`} /></td>;
          })}
        </tr>
      ))}
    </tbody>
  );
}

// Page header placeholder (title + subtitle + an action)
export function SkHeader({ actions = 1 }) {
  return (
    <div className="page-head" aria-hidden="true">
      <div><Sk w={220} h={26} r={8} /><Sk w={340} h={12} style={{ marginTop: 12 }} /></div>
      <div className="page-actions">{Array.from({ length: actions }, (_, i) => <Sk key={i} w={150} h={40} r={999} />)}</div>
    </div>
  );
}

// Label + value pairs (KPI tiles, status strips, summary cards)
export function SkStat({ big = 26, sub = true }) {
  return <div className="sk-stat"><Sk w="45%" h={10} /><Sk w="65%" h={big} r={8} />{sub && <Sk w="55%" h={10} />}</div>;
}
