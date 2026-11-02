const test = require("node:test");
const assert = require("node:assert");
const { computePay, splitHours, dailyTotals } = require("../payroll");

const rule = { overtime_threshold: 6, overtime_multiplier: 1.5, cpp_rate: 0.0595, ei_rate: 0.0164 };
const days = (start, n, h) => Array.from({ length: n }, (_, i) => {
  const d = new Date(start + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i);
  return { work_date: d.toISOString().slice(0, 10), hours_worked: h };
});

test("up to 6 hours a day are regular", () => {
  const r = splitHours(days("2026-10-05", 5, 6), 6, true); // Mon-Fri 6h
  assert.deepStrictEqual(r, { regular: 30, overtime: 0, total: 30 });
});

test("hours above 6 in a day become overtime, per day", () => {
  const r = splitHours(days("2026-10-05", 5, 8), 6, true); // 8h a day -> 6 regular + 2 OT each day
  assert.strictEqual(r.regular, 30);
  assert.strictEqual(r.overtime, 10);
});

test("entries on the same day are added before the daily split", () => {
  const logs = [{ work_date: "2026-10-05", hours_worked: 4 }, { work_date: "2026-10-05", hours_worked: 3.5 }, { work_date: "2026-10-06", hours_worked: 2 }];
  assert.deepStrictEqual(dailyTotals(logs, 6, true), [
    { work_date: "2026-10-05", hours: 7.5, regular: 6, overtime: 1.5 },
    { work_date: "2026-10-06", hours: 2, regular: 2, overtime: 0 },
  ]);
});

test("overtime is not split when employee is not eligible", () => {
  const r = splitHours(days("2026-10-05", 5, 8), 6, false);
  assert.strictEqual(r.regular, 40);
  assert.strictEqual(r.overtime, 0);
});

test("hourly pay with daily overtime, CPP and EI", () => {
  const emp = { employment_type: "hourly", pay_rate: 20, currency: "CAD", overtime_eligible: true };
  const p = computePay(emp, days("2026-10-05", 5, 8), rule);
  // 30*20 + 10*20*1.5 = 900
  assert.strictEqual(p.gross_pay, 900);
  assert.strictEqual(p.cpp_deduction, 53.55);
  assert.strictEqual(p.ei_deduction, 14.76);
  assert.strictEqual(p.net_pay, 831.69);
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
  assert.strictEqual(usd.net_pay_cad, 1260); // (6h x 20 + 2h x 30) x 5 days = 900 USD x 1.4
});
