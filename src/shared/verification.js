export const overallVerificationStatus = checks => {
  const statuses = checks.map(check => check.status);
  if (statuses.includes("REJECTED")) return "REJECTED";
  if (statuses.length && statuses.every(status => status === "VERIFIED"))
    return "VERIFIED";
  if (statuses.includes("PARTIAL") || statuses.includes("VERIFIED"))
    return "PARTIAL";
  if (statuses.includes("PENDING")) return "PENDING";
  return "NOT_STARTED";
};

export const latestVerificationUpdate = checks => {
  let latest = null;
  let latestMilliseconds = Number.NEGATIVE_INFINITY;
  for (const check of checks) {
    const value = check.updatedAt || check.reviewedAt || check.requestedAt;
    if (!value) continue;
    const milliseconds = new Date(value).getTime();
    if (Number.isFinite(milliseconds) && milliseconds > latestMilliseconds) {
      latest = value;
      latestMilliseconds = milliseconds;
    }
  }
  return latest;
};

const summaryCheck = check => ({
  checkType: check.checkType,
  status: check.status,
  reviewedAt: check.reviewedAt || null,
  publicNote: check.publicNote || null,
  updatedAt: check.updatedAt || null
});

export const verificationSummaryForChecks = (propertyId, checks) => ({
  propertyId,
  overallStatus: overallVerificationStatus(checks),
  // This summary is also safely returned to property viewers. Admin action
  // IDs belong to VerificationQueueItem / VerificationCheckDetail instead.
  checks: checks.map(summaryCheck),
  lastUpdatedAt: latestVerificationUpdate(checks)
});
