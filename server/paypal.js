// PayPal Payouts: sends each employee's approved net pay to their email address.
// PayPal emails the employee about the payment; they claim it with a PayPal account under that email.
// Sandbox by default (PAYPAL_ENV=live for real money). https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
const { config } = require("./config");

class PayPalError extends Error {}

const BASE = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" };
const baseUrl = () => (process.env.PAYPAL_API_URL || "").trim().replace(/\/$/, "") || BASE[config.paypalEnv()]; // override only for testing
const configured = () => !!(config.paypalClientId() && config.paypalSecret());

// Item statuses that mean the money did not reach the employee, so the item may be sent again
const RETRYABLE = ["FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED"];
// Item statuses that are final
const FINAL = ["SUCCESS", ...RETRYABLE];

let token = null; // { value, expires, key }
async function accessToken() {
  const key = config.paypalClientId() + ":" + config.paypalSecret();
  if (token && token.key === key && token.expires > Date.now() + 60000) return token.value;
  const res = await call("/v1/oauth2/token", {
    method: "POST", body: "grant_type=client_credentials",
    headers: { Authorization: "Basic " + Buffer.from(key).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
  });
  token = { value: res.access_token, expires: Date.now() + res.expires_in * 1000, key };
  return token.value;
}

async function call(path, opts) {
  let res;
  try { res = await fetch(baseUrl() + path, opts); }
  catch (e) { throw new PayPalError("Could not reach PayPal: " + e.message); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) token = null;
    throw new PayPalError(errorMessage(res.status, body));
  }
  return body;
}

function errorMessage(status, body) {
  if (body.error === "invalid_client") return "PayPal rejected the client ID or secret. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.";
  const name = body.name || body.error || "";
  if (name === "INSUFFICIENT_FUNDS") return "The PayPal business account does not have enough balance for this payout.";
  if (name === "AUTHORIZATION_ERROR" || status === 403) return "This PayPal app is not allowed to send payouts. Enable Payouts for the app in the PayPal developer dashboard.";
  const details = (body.details || []).map((d) => d.description || d.issue).filter(Boolean).join(" ");
  return `PayPal error ${status}${name ? ` (${name})` : ""}: ${body.message || body.error_description || "request failed"}${details ? " " + details : ""}`;
}

async function api(path, opts = {}) {
  const t = await accessToken();
  return call(path, { ...opts, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json", ...(opts.headers || {}) } });
}

const senderItemId = (payrollId) => `iptas-payroll-${payrollId}`;

// The payout request for a list of payroll rows (with employee full_name and email)
function buildPayout(period, rows, company) {
  const label = `${period.start_date} to ${period.end_date}`;
  return {
    sender_batch_header: {
      sender_batch_id: `iptas-period-${period.period_id}-${Date.now()}`,
      email_subject: `You have a payment from ${company}`,
      email_message: `Your net pay for the pay period ${label} has been sent to your PayPal account.`,
    },
    items: rows.map((r) => ({
      recipient_type: "EMAIL",
      receiver: r.email,
      amount: { value: Number(r.net_pay).toFixed(2), currency: r.currency },
      note: `${company} – net pay for ${label}, ${r.full_name}.`,
      sender_item_id: senderItemId(r.payroll_id),
    })),
  };
}

// Sends the payout; returns the PayPal payout_batch_id
async function createPayout(period, rows, company) {
  const r = await api("/v1/payments/payouts", { method: "POST", body: JSON.stringify(buildPayout(period, rows, company)) });
  return r.batch_header.payout_batch_id;
}

// Status of every item in a batch, keyed by payroll_id: { item_id, status, error }
async function payoutItems(batchId) {
  const out = {};
  for (let page = 1; page <= 20; page++) {
    const r = await api(`/v1/payments/payouts/${encodeURIComponent(batchId)}?page_size=1000&page=${page}&total_required=true`);
    for (const it of r.items || []) {
      const m = /^iptas-payroll-(\d+)$/.exec(it.payout_item?.sender_item_id || "");
      if (m) out[m[1]] = { item_id: it.payout_item_id, status: it.transaction_status || "PENDING", error: it.errors?.message || null };
    }
    if (!r.total_pages || page >= r.total_pages) break;
  }
  return out;
}

module.exports = { configured, createPayout, payoutItems, buildPayout, errorMessage, PayPalError, RETRYABLE, FINAL };
