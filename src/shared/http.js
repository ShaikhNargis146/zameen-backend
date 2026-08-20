export const ok = (res, data, meta = {}) =>
  res.status(200).json({ success: true, data, meta });

export const created = (res, data) =>
  res.status(201).json({ success: true, data, meta: {} });

export const fail = (res, status, code, message, details = undefined) => {
  const error = { code, message };
  if (details?.length) error.details = details;
  return res.status(status).json({ success: false, error });
};

export const paginationMeta = ({ page = 1, limit = 20, total = 0 }) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit)
});

export const asyncRoute = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
