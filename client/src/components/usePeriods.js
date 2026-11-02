import { useEffect, useState } from "react";
import { api } from "../api.js";

// Loads pay periods (newest first) and picks a sensible default:
// the current period when preferCurrent (Time Logs), else the latest finished period that still needs payroll
export default function usePeriods({ preferCurrent = false } = {}) {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const reload = async (keep) => {
    const ps = await api("/periods");
    const today = new Date().toISOString().slice(0, 10);
    const started = ps.filter((p) => p.start_date <= today);
    setPeriods(started);
    if (!keep) {
      // Most recent finished period that still needs payroll, else the current period
      const current = started.find((p) => p.start_date <= today && p.end_date >= today);
      const pick = (preferCurrent && current) || started.find((p) => p.status !== "approved" && p.end_date < today) || current || started[0];
      setPeriodId(pick?.period_id || null);
    }
    return started;
  };
  useEffect(() => { reload(false).catch(() => {}); }, []);
  const period = periods.find((p) => p.period_id === periodId);
  return { periods, periodId, setPeriodId, period, reload };
}
