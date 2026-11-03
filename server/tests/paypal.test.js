const test = require("node:test");
const assert = require("node:assert");
const { buildPayout, errorMessage } = require("../paypal");

test("payout sends each net pay to the employee's email in their currency", () => {
  const period = { period_id: 7, start_date: "2026-11-01", end_date: "2026-11-15" };
  const b = buildPayout(period, [
    { payroll_id: 3, net_pay: 512.5, currency: "CAD", email: "ana@example.com", full_name: "Ana Cruz" },
    { payroll_id: 4, net_pay: "99.999", currency: "USD", email: "ben@example.com", full_name: "Ben Lee" },
  ], "Northern Goods Co.");
  assert.match(b.sender_batch_header.sender_batch_id, /^iptas-period-7-\d+$/);
  assert.match(b.sender_batch_header.email_subject, /Northern Goods Co\./);
  assert.deepStrictEqual(b.items.map((i) => [i.recipient_type, i.receiver, i.amount.value, i.amount.currency, i.sender_item_id]), [
    ["EMAIL", "ana@example.com", "512.50", "CAD", "iptas-payroll-3"],
    ["EMAIL", "ben@example.com", "100.00", "USD", "iptas-payroll-4"],
  ]);
});

test("PayPal errors are explained", () => {
  assert.match(errorMessage(401, { error: "invalid_client" }), /PAYPAL_CLIENT_ID/);
  assert.match(errorMessage(422, { name: "INSUFFICIENT_FUNDS" }), /enough balance/);
  assert.match(errorMessage(400, { name: "VALIDATION_ERROR", message: "Invalid request", details: [{ issue: "x", description: "Bad email" }] }), /Bad email/);
});

test("payment email has the amount and the Received link", () => {
  const { paymentEmail } = require("../mailer");
  const m = paymentEmail({ company: "Northern Goods Co.", name: "Ana <Cruz>", period: { start_date: "2026-11-01", end_date: "2026-11-15" },
    row: { net_pay: 1234.5, currency: "CAD", email: "ana@example.com", regular_hours: 60, overtime_hours: 2, gross_pay: 1400, cpp_deduction: 80, ei_deduction: 23 },
    receiptUrl: "https://iptas.example/api/receipt/abc", paypalUrl: "https://www.sandbox.paypal.com/myaccount/summary" });
  assert.match(m.subject, /C\$1,234\.50/);
  assert.match(m.html, /href="https:\/\/iptas\.example\/api\/receipt\/abc"[^>]*>Received</);
  assert.match(m.html, /Ana &lt;Cruz&gt;/);
  assert.match(m.text, /receipt\/abc/);
});
