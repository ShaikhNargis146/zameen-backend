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

export const verificationSummaryForChecks = (propertyId, checks) => ({
  propertyId,
  overallStatus: overallVerificationStatus(checks),
  checks,
  lastUpdatedAt: latestVerificationUpdate(checks)
});
