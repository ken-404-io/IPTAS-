const test = require("node:test");
const assert = require("node:assert");
const { computePay, splitHours } = require("../payroll");

const rule = { overtime_threshold: 40, overtime_multiplier: 1.5, cpp_rate: 0.0595, ei_rate: 0.0164 };
const days = (start, n, h) => Array.from({ length: n }, (_, i) => {
  const d = new Date(start + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i);
  return { work_date: d.toISOString().slice(0, 10), hours_worked: h };
});

test("hours under the weekly threshold are all regular", () => {
  const r = splitHours(days("2026-10-05", 5, 8), 40, true); // Mon-Fri 8h
  assert.deepStrictEqual(r, { regular: 40, overtime: 0, total: 40 });
});

test("hours over 40 in a week become overtime", () => {
  const r = splitHours(days("2026-10-05", 5, 9), 40, true); // 45h
  assert.strictEqual(r.regular, 40);
  assert.strictEqual(r.overtime, 5);
});

test("overtime is not split when employee is not eligible", () => {
  const r = splitHours(days("2026-10-05", 5, 9), 40, false);
  assert.strictEqual(r.regular, 45);
  assert.strictEqual(r.overtime, 0);
});

test("hourly pay with overtime, CPP and EI", () => {
  const emp = { employment_type: "hourly", pay_rate: 20, currency: "CAD", overtime_eligible: true };
  const p = computePay(emp, days("2026-10-05", 5, 9), rule);
  // 40*20 + 5*20*1.5 = 950
  assert.strictEqual(p.gross_pay, 950);
  assert.strictEqual(p.cpp_deduction, 56.53);
  assert.strictEqual(p.ei_deduction, 15.58);
  assert.strictEqual(p.net_pay, 877.89);
  assert.strictEqual(p.net_pay_cad, 877.89);
});

test("fixed pay employee in USD converted to CAD", () => {
  const emp = { employment_type: "fixed", pay_rate: 1000, currency: "USD", overtime_eligible: false };
  const p = computePay(emp, days("2026-10-05", 10, 8), rule, 1.37);
  assert.strictEqual(p.gross_pay, 1000);
  assert.strictEqual(p.net_pay, 1000);
  assert.strictEqual(p.net_pay_cad, 1370);
});

test("CPP and EI apply only to employees paid in CAD", () => {
  const cad = computePay({ employment_type: "hourly", pay_rate: 20, currency: "CAD", overtime_eligible: true }, days("2026-10-05", 5, 8), rule);
  const usd = computePay({ employment_type: "hourly", pay_rate: 20, currency: "USD", overtime_eligible: true }, days("2026-10-05", 5, 8), rule, 1.4);
  assert.ok(cad.cpp_deduction > 0 && cad.ei_deduction > 0);
  assert.strictEqual(usd.cpp_deduction, 0);
  assert.strictEqual(usd.fx_rate, 1.4);
  assert.strictEqual(usd.net_pay_cad, 1120);
});
