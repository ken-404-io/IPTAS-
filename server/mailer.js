// Sends email through an HTTP email API (SMTP ports are often blocked on free hosting).
// Brevo (BREVO_API_KEY) is preferred: it sends to any address once the sender email is verified.
// Resend (RESEND_API_KEY) also works, but without a verified domain it only sends to your own Resend email.
const { config } = require("./config");

class MailError extends Error {}

const provider = () => (config.brevoKey() ? "brevo" : config.resendKey() ? "resend" : "");
const configured = () => !!(provider() && config.emailFrom());

async function sendMail({ to, toName, subject, html, text }) {
  if (!configured()) throw new MailError("Email is not set up (BREVO_API_KEY and EMAIL_FROM).");
  const from = config.emailFrom(), fromName = config.companyName();
  let res;
  try {
    res = provider() === "brevo"
      ? await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", headers: { "api-key": config.brevoKey(), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sender: { email: from, name: fromName }, to: [{ email: to, name: toName || to }], subject, htmlContent: html, textContent: text }),
      })
      : await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: "Bearer " + config.resendKey(), "Content-Type": "application/json" },
        body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, html, text }),
      });
  } catch (e) { throw new MailError("Could not reach the email service: " + e.message); }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new MailError(`Email to ${to} failed (${res.status}): ${b.message || b.error || b.name || "rejected"}`);
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, cur) => `${cur === "USD" ? "US$" : "C$"}${Number(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "You have been paid" email with a button to confirm the money was received
function paymentEmail({ company, name, period, row, receiptUrl, paypalUrl }) {
  const amount = fmt(row.net_pay, row.currency);
  const label = `${period.start_date} to ${period.end_date}`;
  const line = (k, v) => `<tr><td style="padding:6px 0;color:#666">${esc(k)}</td><td style="padding:6px 0;text-align:right"><b>${esc(v)}</b></td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,sans-serif;color:#222">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;padding:28px">
  <h2 style="margin:0 0 4px;color:#C8213A">${esc(company)}</h2>
  <p style="margin:0 0 20px;color:#666">Payroll payment</p>
  <p>Hi ${esc(name)},</p>
  <p>Your net pay of <b>${esc(amount)}</b> for the pay period <b>${esc(label)}</b> was sent to your PayPal account (<b>${esc(row.email)}</b>).</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
    ${line("Regular hours", Number(row.regular_hours).toFixed(2))}${line("Overtime hours", Number(row.overtime_hours).toFixed(2))}
    ${line("Gross pay", fmt(row.gross_pay, row.currency))}${line("CPP", "– " + fmt(row.cpp_deduction, row.currency))}${line("EI", "– " + fmt(row.ei_deduction, row.currency))}
    <tr><td style="padding:10px 0;border-top:1px solid #eee"><b>Net pay</b></td><td style="padding:10px 0;border-top:1px solid #eee;text-align:right;color:#C8213A"><b>${esc(amount)}</b></td></tr>
  </table>
  <p>1. Open PayPal and accept the payment (log in or sign up with ${esc(row.email)}):</p>
  <p><a href="${esc(paypalUrl)}" style="display:inline-block;background:#0070ba;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open PayPal</a></p>
  <p>2. When the money is in your PayPal account, confirm it:</p>
  <p><a href="${esc(receiptUrl)}" style="display:inline-block;background:#C8213A;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Received</a></p>
  <p style="font-size:12px;color:#888">If you did not receive it, do not click Received; reply to your employer instead.</p>
</div></body></html>`;
  const text = `Hi ${name},\n\nYour net pay of ${amount} for ${label} was sent to your PayPal account (${row.email}).\n\n` +
    `1. Accept it in PayPal: ${paypalUrl}\n2. When it is in your PayPal account, confirm it here: ${receiptUrl}\n\n${company}`;
  return { subject: `${company}: you have been paid ${amount}`, html, text };
}

module.exports = { configured, provider, sendMail, paymentEmail, MailError, esc, fmt };
