const test = require("node:test");
const assert = require("node:assert");
const { durationHours, entryHours, localDate } = require("../timetracker");

test("Clockify durations are converted to hours", () => {
  assert.strictEqual(durationHours("PT8H"), 8);
  assert.strictEqual(durationHours("PT7H30M"), 7.5);
  assert.strictEqual(durationHours("PT45M"), 0.75);
  assert.strictEqual(durationHours("P1DT2H"), 26);
  assert.strictEqual(durationHours(null), 0);
});

test("entry hours come from the start and end times", () => {
  assert.strictEqual(entryHours({ start: "2026-10-12T13:00:00Z", end: "2026-10-12T21:30:00Z", duration: "PT8H30M" }), 8.5);
  assert.strictEqual(entryHours({ start: "2026-10-12T13:00:00Z", end: null, duration: "PT2H" }), 2);
});

test("work date uses the business time zone", () => {
  // 9 pm Friday in Toronto is already Saturday in UTC
  assert.strictEqual(localDate("2026-10-24T01:00:00Z", "America/Toronto"), "2026-10-23");
  assert.strictEqual(localDate("2026-10-24T01:00:00Z", "UTC"), "2026-10-24");
  assert.strictEqual(localDate("2026-10-23T20:00:00Z", "Asia/Manila"), "2026-10-24");
});
