import { useState } from "react";

// Real-time form validation: a field shows its error as soon as the user types in it or leaves it,
// and every error shows once they try to submit. `validate(values)` returns { field: "message" | "" }.
export function useValidation(values, validate) {
  const [touched, setTouched] = useState({});
  const errors = validate(values);
  const valid = Object.values(errors).every((e) => !e);
  const touch = (k) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const shown = (k) => (touched[k] || touched.__all ? errors[k] || "" : "");
  return {
    errors, valid, shown,
    touchAll: () => setTouched((t) => ({ ...t, __all: true })),
    reset: () => setTouched({}),
    // Spread onto an <input>/<select>: marks it touched while typing and on blur, and styles it
    bind: (k) => {
      const show = touched[k] || touched.__all;
      return {
        onInput: () => touch(k), onBlur: () => touch(k),
        "aria-invalid": show && errors[k] ? true : undefined,
        "aria-describedby": show && errors[k] ? `err-${k}` : undefined,
        className: show ? (errors[k] ? "invalid" : "valid") : undefined,
      };
    },
  };
}

export function FieldError({ name, msg }) {
  return msg ? <span id={`err-${name}`} className="field-error" role="alert">{msg}</span> : null;
}

// ----- shared rules (the server checks the same limits) -----
const trimmed = (v) => String(v ?? "").trim();
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const NAME_RE = /^[\p{L}][\p{L} .,'’-]*$/u;

export function checkName(v, label = "Name") {
  const s = trimmed(v);
  if (!s) return `${label} is required.`;
  if (s.length < 2) return `${label} must be at least 2 characters.`;
  if (s.length > 100) return `${label} must be 100 characters or fewer.`;
  if (!NAME_RE.test(s)) return `${label} can only contain letters, spaces, periods, apostrophes and hyphens.`;
  return "";
}

export function checkEmail(v, taken = []) {
  const s = trimmed(v).toLowerCase();
  if (!s) return "Email is required.";
  if (s.length > 100) return "Email must be 100 characters or fewer.";
  if (!EMAIL_RE.test(s)) return "Enter a valid email, like name@example.com.";
  if (taken.includes(s)) return "This email is already used.";
  return "";
}

export const passwordChecks = (pw) => [
  { ok: String(pw).length >= 8, text: "At least 8 characters" },
  { ok: /[A-Za-z]/.test(pw), text: "A letter" },
  { ok: /\d/.test(pw), text: "A number" },
];
export function checkPassword(pw) {
  if (!pw) return "Password is required.";
  if (String(pw).length > 72) return "Password must be 72 characters or fewer.";
  return passwordChecks(pw).every((c) => c.ok) ? "" : "Use at least 8 characters with a letter and a number.";
}

// Number within [min, max] with at most `decimals` decimal places
export function checkNumber(v, { label, min, max, decimals = 2, minExclusive = false }) {
  const s = trimmed(v);
  if (s === "") return `${label} is required.`;
  const n = Number(s);
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (minExclusive ? n <= min : n < min) return `${label} must be ${minExclusive ? "more than" : "at least"} ${min}.`;
  if (n > max) return `${label} must be at most ${max}.`;
  const dec = (s.split(".")[1] || "").length;
  if (dec > decimals) return `${label} can have at most ${decimals} decimal place${decimals === 1 ? "" : "s"}.`;
  return "";
}

export function checkDate(v, { label = "Date", maxYearsAhead = 1 } = {}) {
  const s = trimmed(v);
  if (!s) return `${label} is required.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + "T00:00:00Z"))) return `Enter a valid ${label.toLowerCase()}.`;
  if (s < "2000-01-01") return `${label} must be in 2000 or later.`;
  const limit = new Date(); limit.setFullYear(limit.getFullYear() + maxYearsAhead);
  if (s > limit.toISOString().slice(0, 10)) return `${label} can be at most ${maxYearsAhead} year ahead.`;
  return "";
}

export function PasswordChecklist({ value }) {
  return (
    <ul className="pw-checks" aria-label="Password requirements">
      {passwordChecks(value).map((c) => <li key={c.text} className={c.ok ? "ok" : ""}>{c.ok ? "✓" : "○"} {c.text}</li>)}
    </ul>
  );
}
