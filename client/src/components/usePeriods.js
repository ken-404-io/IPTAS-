import { useEffect, useState } from "react";
import { api } from "../api.js";

// Loads pay periods and picks a sensible default (first period that is not approved and has started)
export default function usePeriods() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const reload = async (keep) => {
    const ps = await api("/periods");
    const today = new Date().toISOString().slice(0, 10);
    const started = ps.filter((p) => p.start_date <= today);
    setPeriods(started);
    if (!keep) {
      const pick = [...started].reverse().find((p) => p.status !== "approved" && p.end_date < today)
        || started.find((p) => p.start_date <= today && p.end_date >= today) || started[0];
      setPeriodId(pick?.period_id || null);
    }
    return started;
  };
  useEffect(() => { reload(false).catch(() => {}); }, []);
  const period = periods.find((p) => p.period_id === periodId);
  return { periods, periodId, setPeriodId, period, reload };
}
