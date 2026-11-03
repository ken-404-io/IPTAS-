// Server configuration from environment variables (there is no settings table in the Lab 005 ERD).
// On Render: Dashboard -> your service -> Environment. Locally: the .env file.
const DEFAULT_TZ = "America/Toronto";

function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
}

const config = {
  companyName: () => process.env.COMPANY_NAME || "Northern Goods Co.",
  storefrontUrl: () => process.env.STOREFRONT_URL || "https://www.shopify.com",
  timezone: () => (process.env.TIMEZONE && isValidTimezone(process.env.TIMEZONE) ? process.env.TIMEZONE : DEFAULT_TZ),
  clockifyKey: () => (process.env.CLOCKIFY_API_KEY || "").trim(),
  clockifyWorkspace: () => (process.env.CLOCKIFY_WORKSPACE_ID || "").trim(),
  // Default USD to CAD rate offered when computing payroll (the rate actually used is saved in payroll.fx_rate)
  defaultFx: () => Number(process.env.FX_USD_TO_CAD) > 0 ? Number(process.env.FX_USD_TO_CAD) : 1.37,
  googleClientId: () => (process.env.GOOGLE_CLIENT_ID || "").trim(),
  // PayPal Payouts (pay employees by email). Sandbox unless PAYPAL_ENV=live.
  paypalClientId: () => (process.env.PAYPAL_CLIENT_ID || "").trim(),
  paypalSecret: () => (process.env.PAYPAL_CLIENT_SECRET || "").trim(),
  paypalEnv: () => ((process.env.PAYPAL_ENV || "").trim().toLowerCase() === "live" ? "live" : "sandbox"),
};

module.exports = { config, isValidTimezone, DEFAULT_TZ };
