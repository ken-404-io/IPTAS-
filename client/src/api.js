const TOKEN_KEY = "iptas_token";
const USER_KEY = "iptas_user";

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, v) { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch { /* storage unavailable */ } }

let memoryToken = read(TOKEN_KEY);

export function getUser() {
  try { return JSON.parse(read(USER_KEY) || "null"); } catch { return null; }
}
export function setSession(token, user) {
  memoryToken = token;
  write(TOKEN_KEY, token);
  write(USER_KEY, user ? JSON.stringify(user) : null);
}
export function clearSession() { setSession(null, null); }

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(memoryToken ? { Authorization: "Bearer " + memoryToken } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== "/auth/login") {
    clearSession();
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const money = (n, cur = "CAD") =>
  (cur === "USD" ? "US$" : "C$") + Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const hrs = (n) => Number(n || 0).toLocaleString("en-CA", { maximumFractionDigits: 2 });
export const fmtDate = (d) => d ? new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "";
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
export const periodLabel = (p) => p ? `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}` : "";
