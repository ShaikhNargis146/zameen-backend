import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timeSlots = new Set(["MORNING", "AFTERNOON", "EVENING"]);
const siteVisitStatuses = new Set([
  "REQUESTED",
  "CONFIRMED",
  "RESCHEDULED",
  "COMPLETED",
  "CANCELLED"
]);
const completeEnquiryStatuses = new Set(["INTERESTED", "CLOSED", "LOST"]);

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};

const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be at most ${max} characters.`
    );
  return text;
};

const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toUpperCase();
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
  return text;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
  return text;
};

const requiredDate = (value, field) => {
  const text = String(value ?? "").trim();
  if (!datePattern.test(text))
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a date in YYYY-MM-DD format.`);
  const today = new Date().toISOString().slice(0, 10);
  if (text < today)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be today or a future date.`);
  return text;
};

const optionalDate = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!datePattern.test(text))
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a date in YYYY-MM-DD format.`);
  return text;
};

const optionalVisitorCount = value => {
  if (value === undefined || value === null || value === "") return 1;
  const count = Number.parseInt(value, 10);
  if (!Number.isInteger(count) || count < 1 || count > 20)
    throw new HttpError(400, "INVALID_VISITOR_COUNT", "visitorCount must be between 1 and 20.");
  return count;
};

const requiredFutureDatetime = (value, field) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a valid datetime.`);
  if (date.getTime() <= Date.now())
    throw new HttpError(400, `INVALID_${field}`, `${field} must be in the future.`);
  return date.toISOString();
};

export const createSiteVisit = body => ({
  preferredDate: requiredDate(body.preferredDate, "PREFERRED_DATE"),
  preferredTimeSlot: requiredEnum(
    body.preferredTimeSlot,
    timeSlots,
    "PREFERRED_TIME_SLOT",
    "MORNING, AFTERNOON, or EVENING"
  ),
  visitorCount: optionalVisitorCount(body.visitorCount),
  note: optionalString(body.note, 500, "NOTE")
});

export const visitListQuery = query => ({
  status: optionalEnum(query.status, siteVisitStatuses, "STATUS", "a valid SiteVisitStatus"),
  fromDate: optionalDate(query.fromDate, "FROM_DATE"),
  toDate: optionalDate(query.toDate, "TO_DATE")
});

export const confirmSiteVisit = body => ({
  scheduledAt: requiredFutureDatetime(body.scheduledAt, "SCHEDULED_AT"),
  sellerNote: optionalString(body.sellerNote, 500, "SELLER_NOTE")
});

export const rescheduleSiteVisit = body => ({
  scheduledAt: requiredFutureDatetime(body.scheduledAt, "SCHEDULED_AT"),
  note: optionalString(body.note, 500, "NOTE")
});

export const cancelSiteVisit = body => ({
  reason: optionalString(body?.reason, 1000, "REASON")
});

export const completeSiteVisit = body => ({
  sellerNote: optionalString(body.sellerNote, 1000, "SELLER_NOTE"),
  enquiryStatus: optionalEnum(
    body.enquiryStatus,
    completeEnquiryStatuses,
    "ENQUIRY_STATUS",
    "INTERESTED, CLOSED, or LOST"
  )
});
