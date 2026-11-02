// Salary computation engine (Module 3). Pure functions so they can be unit-tested.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Monday-based week key for a YYYY-MM-DD date string
function weekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Split hours into regular and overtime using a weekly threshold.
 * logs: [{ work_date: 'YYYY-MM-DD', hours_worked: number }]
 */
function splitHours(logs, threshold, overtimeEligible) {
  const weeks = {};
  for (const l of logs) {
    const k = weekKey(l.work_date);
    weeks[k] = (weeks[k] || 0) + Number(l.hours_worked);
  }
  let regular = 0, overtime = 0;
  for (const h of Object.values(weeks)) {
    if (overtimeEligible && h > threshold) {
      regular += threshold;
      overtime += h - threshold;
    } else {
      regular += h;
    }
  }
  return { regular: round2(regular), overtime: round2(overtime), total: round2(regular + overtime) };
}

/**
 * Compute one employee's pay for one pay period.
 * employee: { employment_type, pay_rate, currency, overtime_eligible, apply_deductions }
 * rule:     { overtime_threshold, overtime_multiplier, cpp_rate, ei_rate, fx_usd_to_cad }
 * For fixed employees, pay_rate is the amount per pay period; overtime (if eligible) is paid at
 * the equivalent hourly rate = pay_rate / (threshold * 2 weeks).
 */
function computePay(employee, logs, rule) {
  const threshold = Number(rule.overtime_threshold);
  const mult = Number(rule.overtime_multiplier);
  const rate = Number(employee.pay_rate);
  const { regular, overtime } = splitHours(logs, threshold, employee.overtime_eligible);

  let gross;
  if (employee.employment_type === "hourly") {
    gross = regular * rate + overtime * rate * mult;
  } else {
    const hourlyEquivalent = rate / (threshold * 2);
    gross = rate + overtime * hourlyEquivalent * mult;
  }
  gross = round2(gross);

  const cpp = employee.apply_deductions ? round2(gross * Number(rule.cpp_rate)) : 0;
  const ei = employee.apply_deductions ? round2(gross * Number(rule.ei_rate)) : 0;
  const net = round2(gross - cpp - ei);
  const fx = employee.currency === "USD" ? Number(rule.fx_usd_to_cad) : 1;

  return {
    regular_hours: regular,
    overtime_hours: overtime,
    gross_pay: gross,
    cpp_deduction: cpp,
    ei_deduction: ei,
    net_pay: net,
    currency: employee.currency,
    fx_rate: fx,
    net_pay_cad: round2(net * fx),
  };
}

module.exports = { computePay, splitHours, weekKey, round2 };
