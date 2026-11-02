// Verifies a "Sign in with Google" ID token using Google's tokeninfo endpoint.
const TOKENINFO = "https://oauth2.googleapis.com/tokeninfo?id_token=";

class GoogleAuthError extends Error {}

// Pure check of the token fields, so it can be unit-tested
function checkClaims(info, clientId, nowSec = Math.floor(Date.now() / 1000)) {
  if (!info || info.aud !== clientId) throw new GoogleAuthError("This Google sign-in was not issued for IPTAS.");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(info.iss)) throw new GoogleAuthError("Invalid Google sign-in.");
  if (Number(info.exp) < nowSec) throw new GoogleAuthError("The Google sign-in expired. Please try again.");
  if (!(info.email_verified === true || info.email_verified === "true")) throw new GoogleAuthError("Your Google email address is not verified.");
  if (!info.sub || !info.email) throw new GoogleAuthError("Invalid Google sign-in.");
  return { sub: String(info.sub), email: String(info.email).toLowerCase(), name: info.name || info.email.split("@")[0] };
}

async function verifyGoogleToken(credential, clientId) {
  if (!clientId) throw new GoogleAuthError("Google sign-in is not set up on this server.");
  if (!credential || typeof credential !== "string") throw new GoogleAuthError("Missing Google credential.");
  let res;
  try {
    res = await fetch(TOKENINFO + encodeURIComponent(credential), { signal: AbortSignal.timeout(10000) });
  } catch {
    throw new GoogleAuthError("Could not reach Google. Please try again.");
  }
  if (!res.ok) throw new GoogleAuthError("Google could not verify this sign-in. Please try again.");
  return checkClaims(await res.json(), clientId);
}

module.exports = { verifyGoogleToken, checkClaims, GoogleAuthError };
