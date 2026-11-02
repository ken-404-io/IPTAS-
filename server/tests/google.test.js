const test = require("node:test");
const assert = require("node:assert");
const { checkClaims } = require("../google");

const CID = "123.apps.googleusercontent.com";
const good = { aud: CID, iss: "https://accounts.google.com", exp: "9999999999", email_verified: "true", sub: "42", email: "Harold@Example.com", name: "Harold" };

test("a valid Google token is accepted and the email is lower-cased", () => {
  assert.deepStrictEqual(checkClaims(good, CID), { sub: "42", email: "harold@example.com", name: "Harold" });
});
test("tokens for another app, expired or unverified are rejected", () => {
  assert.throws(() => checkClaims({ ...good, aud: "other" }, CID));
  assert.throws(() => checkClaims({ ...good, exp: "1" }, CID));
  assert.throws(() => checkClaims({ ...good, email_verified: "false" }, CID));
  assert.throws(() => checkClaims({ ...good, iss: "evil.com" }, CID));
});
