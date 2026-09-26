import assert from "node:assert/strict";
import test from "node:test";

import { resolveUsageCycle } from "../../src/shared/usageCycle.js";

// ---------------------------------------------------------------------------
// resolveUsageCycle — the core of "usage resets on plan renewal, at any
// time, not just on the calendar month." Anchored to a plan_subscriptions
// row's own starts_at (see the file's own header comment for why that column
// specifically), rolling forward one whole month at a time so the reset day
// always matches whichever day of the month the CURRENT subscription
// actually started/renewed on -- not always the 1st.
// ---------------------------------------------------------------------------

test("with no anchor at all, falls back to the plain wall-clock calendar month (the pre-existing, last-resort behavior)", () => {
  const { periodStart, periodEnd } = resolveUsageCycle({
    anchorStartsAt: null,
    now: new Date("2026-09-13T10:00:00.000Z")
  });
  assert.equal(periodStart.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("undefined anchor is treated the same as null", () => {
  const { periodStart } = resolveUsageCycle({ now: new Date("2026-09-13T10:00:00.000Z") });
  assert.equal(periodStart.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("the very first moment of a subscription's life: now === starts_at opens cycle 0 immediately", () => {
  const anchor = new Date("2026-09-13T08:15:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({ anchorStartsAt: anchor, now: anchor });
  assert.equal(periodStart.toISOString(), anchor.toISOString());
  assert.equal(periodEnd.toISOString(), "2026-10-13T08:15:00.000Z");
});

test("mid-cycle: a plan that started on the 13th resets on the 13th of each month, not the 1st", () => {
  const anchor = new Date("2026-09-13T08:15:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({
    anchorStartsAt: anchor,
    now: new Date("2026-10-05T00:00:00.000Z")
  });
  assert.equal(periodStart.toISOString(), "2026-09-13T08:15:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-10-13T08:15:00.000Z");
});

test("just past a cycle boundary rolls into the next month's cycle", () => {
  const anchor = new Date("2026-09-13T08:15:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({
    anchorStartsAt: anchor,
    now: new Date("2026-10-13T08:15:00.001Z")
  });
  assert.equal(periodStart.toISOString(), "2026-10-13T08:15:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-11-13T08:15:00.000Z");
});

test("exactly at a cycle boundary is already the NEXT cycle (periodEnd is exclusive)", () => {
  const anchor = new Date("2026-09-13T08:15:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({
    anchorStartsAt: anchor,
    now: new Date("2026-10-13T08:15:00.000Z")
  });
  assert.equal(periodStart.toISOString(), "2026-10-13T08:15:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-11-13T08:15:00.000Z");
});

test("many months later still resolves the correct cycle, without drifting off the anchor's day", () => {
  const anchor = new Date("2026-01-15T00:00:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({
    anchorStartsAt: anchor,
    now: new Date("2026-11-20T00:00:00.000Z")
  });
  assert.equal(periodStart.toISOString(), "2026-11-15T00:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-12-15T00:00:00.000Z");
});

// Clamping: a plan anchored on the 31st must clamp to the last day of
// shorter months rather than overflowing into the wrong month, and must
// still recover the 31st once a long-enough month comes back around --
// computed fresh from the original anchor each cycle, never chained from a
// previously clamped date, so it never drifts to e.g. always the 28th.
test("an anchor on the 31st clamps to the last day of a shorter month, and recovers the 31st when the month is long enough again", () => {
  const anchor = new Date("2026-01-31T00:00:00.000Z");

  const feb = resolveUsageCycle({ anchorStartsAt: anchor, now: new Date("2026-02-15T00:00:00.000Z") });
  assert.equal(feb.periodStart.toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(feb.periodEnd.toISOString(), "2026-02-28T00:00:00.000Z"); // 2026 is not a leap year

  const mar = resolveUsageCycle({ anchorStartsAt: anchor, now: new Date("2026-03-01T00:00:00.000Z") });
  assert.equal(mar.periodStart.toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(mar.periodEnd.toISOString(), "2026-03-31T00:00:00.000Z"); // recovers the 31st, no drift to the 28th

  const apr = resolveUsageCycle({ anchorStartsAt: anchor, now: new Date("2026-04-15T00:00:00.000Z") });
  assert.equal(apr.periodStart.toISOString(), "2026-03-31T00:00:00.000Z");
  assert.equal(apr.periodEnd.toISOString(), "2026-04-30T00:00:00.000Z");
});

test("a leap-year February 29th anchor clamps correctly on non-leap years, and recovers day 29 the following month", () => {
  const anchor = new Date("2024-02-29T00:00:00.000Z"); // 2024 is a leap year
  // 2026-02-15 falls in the cycle running 2026-01-29 -> 2026-02-28 (Feb
  // clamped to 28 since 2026 isn't a leap year) -- not a Feb-anchored cycle,
  // since the anchor's day (29) hasn't been reached yet this calendar month.
  const { periodStart, periodEnd } = resolveUsageCycle({
    anchorStartsAt: anchor,
    now: new Date("2026-02-15T00:00:00.000Z") // 2026 is not a leap year
  });
  assert.equal(periodStart.toISOString(), "2026-01-29T00:00:00.000Z");
  assert.equal(periodEnd.toISOString(), "2026-02-28T00:00:00.000Z");

  const next = resolveUsageCycle({ anchorStartsAt: anchor, now: new Date("2026-03-01T00:00:00.000Z") });
  assert.equal(next.periodStart.toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(next.periodEnd.toISOString(), "2026-03-29T00:00:00.000Z"); // recovers day 29, no drift to 28
});

test("accepts a string/ISO anchor (as returned by the DB driver), not just a Date instance", () => {
  const { periodStart } = resolveUsageCycle({
    anchorStartsAt: "2026-09-13T08:15:00.000Z",
    now: new Date("2026-10-05T00:00:00.000Z")
  });
  assert.equal(periodStart.toISOString(), "2026-09-13T08:15:00.000Z");
});

// The scenario the feature exists for: a plan renews EARLY (before its
// natural monthly cycle would have rolled over on its own) -- the new
// starts_at becomes the new anchor immediately, so the very next
// resolveUsageCycle call for this owner opens a brand-new cycle starting
// right now, not "whenever the old cycle would have ended."
test("an early renewal (new starts_at before the old cycle would have ended) opens a fresh cycle starting immediately at the renewal instant", () => {
  const renewalInstant = new Date("2026-09-20T12:00:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({ anchorStartsAt: renewalInstant, now: renewalInstant });
  assert.equal(periodStart.toISOString(), renewalInstant.toISOString());
  assert.equal(periodEnd.toISOString(), "2026-10-20T12:00:00.000Z");
});
