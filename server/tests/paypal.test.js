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
