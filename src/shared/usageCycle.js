// Resolves the "billing cycle" window a periodic ("N per month") usage
// counter should be scoped to. Anchored to the owner's CURRENT
// commerce.plan_subscriptions.starts_at, not the wall-clock calendar month —
// so usage resets the moment a plan is purchased, upgraded, or renewed, at
// whatever day of the month that happens to land on, rather than only on the
// 1st. capturePaymentAndApplyEntitlements (commerce.repository.js) always
// inserts a FRESH plan_subscriptions row with starts_at = the purchase
// instant for every one of those three events (never mutates an existing
// row's starts_at) — anchoring here to that column is what makes "usage
// resets on renewal" fall out automatically, with no explicit reset job:
// the new anchor simply doesn't match any period_start a prior cycle wrote,
// so the counter starts fresh at 0 under the new key.
//
// anchorStartsAt is null for the one case where there is no real
// subscription instance to anchor to at all -- the ambient last-resort
// fallback when even the PLAN_FREE catalog row itself isn't seeded (see
// commerce.service.js#FREE_PLAN_DEFAULTS) -- and calendar-month scoping is
// kept there as the pre-existing last-resort behavior.
//
// now is accepted explicitly (mirrors commerce.repository.js#computePlanEndsAt's
// own `now` parameter) so callers/tests can pin it instead of depending on
// the real wall clock.
const daysInMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// Advances `date` by `months`, clamping the day-of-month to the target
// month's actual length (e.g. Jan 31 + 1 month -> Feb 28/29, not Mar 3).
// Always computed from the original `date`, never chained from a previously
// clamped result, so repeated calls never drift off the anchor's true day.
const addMonthsClamped = (date, months) => {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
};

export const resolveUsageCycle = ({ anchorStartsAt, now = new Date() }) => {
  const nowDate = now instanceof Date ? now : new Date(now);

  if (anchorStartsAt === null || anchorStartsAt === undefined) {
    const periodStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
    return { periodStart, periodEnd: addMonthsClamped(periodStart, 1) };
  }

  const anchor = anchorStartsAt instanceof Date ? anchorStartsAt : new Date(anchorStartsAt);
  if (nowDate <= anchor) return { periodStart: anchor, periodEnd: addMonthsClamped(anchor, 1) };

  // Find the whole number of anchor-months elapsed so `now` falls inside
  // [anchor + n months, anchor + (n+1) months).
  let months =
    (nowDate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (nowDate.getUTCMonth() - anchor.getUTCMonth());
  if (addMonthsClamped(anchor, months) > nowDate) months -= 1;
  while (addMonthsClamped(anchor, months + 1) <= nowDate) months += 1;

  return { periodStart: addMonthsClamped(anchor, months), periodEnd: addMonthsClamped(anchor, months + 1) };
};
