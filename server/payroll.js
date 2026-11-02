// Salary computation engine (Module 3). Pure functions so they can be unit-tested.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const WORKDAYS_PER_PERIOD = 10; // a two-week pay period has 10 working days (Mon-Fri)

/**
 * Daily overtime: on each day, the first `threshold` hours (6 by default) are regular and the rest is overtime.
 * logs: [{ work_date: 'YYYY-MM-DD', hours_worked: number }]
 * Returns one row per day: { work_date, hours, regular, overtime }, oldest first.
 */
function dailyTotals(logs, threshold, overtimeEligible) {
  const days = {};
  for (const l of logs) days[l.work_date] = (days[l.work_date] || 0) + Number(l.hours_worked);
  return Object.keys(days).sort().map((d) => {
    const h = round2(days[d]);
    const regular = overtimeEligible ? Math.min(h, threshold) : h;
    return { work_date: d, hours: h, regular: round2(regular), overtime: round2(h - regular) };
  });
}

// Total regular and overtime hours for a pay period (sum of the daily split)
function splitHours(logs, threshold, overtimeEligible) {
  let regular = 0, overtime = 0;
  for (const d of dailyTotals(logs, threshold, overtimeEligible)) { regular += d.regular; overtime += d.overtime; }
  return { regular: round2(regular), overtime: round2(overtime), total: round2(regular + overtime) };
}

// CPP and EI apply to employees on Canadian payroll (paid in CAD); USD workers are paid as foreign contractors
const hasCanadianDeductions = (employee) => employee.currency === "CAD";

/**
 * Compute one employee's pay for one pay period.
 * employee: { employment_type, pay_rate, currency, overtime_eligible }
 * rule:     { overtime_threshold (hours per day), overtime_multiplier, cpp_rate, ei_rate }
 * fxRate:   USD to CAD rate used for this payroll (only applied to USD employees)
 * For fixed employees, pay_rate is the amount per pay period; overtime (if eligible) is paid at
 * the equivalent hourly rate = pay_rate / (threshold hours x 10 working days).
 */
function computePay(employee, logs, rule, fxRate = 1) {
  const threshold = Number(rule.overtime_threshold);
  const mult = Number(rule.overtime_multiplier);
  const rate = Number(employee.pay_rate);
  const { regular, overtime } = splitHours(logs, threshold, employee.overtime_eligible);

  let gross;
  if (employee.employment_type === "hourly") {
    gross = regular * rate + overtime * rate * mult;
  } else {
    const hourlyEquivalent = rate / (threshold * WORKDAYS_PER_PERIOD);
    gross = rate + overtime * hourlyEquivalent * mult;
  }
  gross = round2(gross);

  const deduct = hasCanadianDeductions(employee);
  const cpp = deduct ? round2(gross * Number(rule.cpp_rate)) : 0;
  const ei = deduct ? round2(gross * Number(rule.ei_rate)) : 0;
  const net = round2(gross - cpp - ei);
  const fx = employee.currency === "USD" ? Number(fxRate) : 1;

  return {
    regular_hours: regular,
    overtime_hours: overtime,
    gross_pay: gross,
    cpp_deduction: cpp,
    ei_deduction: ei,
    net_pay: net,
    currency: employee.currency,
    fx_rate: fx,
    net_pay_cad: round2(net * fx), // shown and totalled, not stored (net_pay x fx_rate)
  };
}

module.exports = { computePay, splitHours, dailyTotals, round2, hasCanadianDeductions };
