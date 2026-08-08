export const ok = (res, data, meta = {}) =>
  res.status(200).json({ success: true, data, meta });

export const created = (res, data) =>
  res.status(201).json({ success: true, data, meta: {} });

export const fail = (res, status, code, message) =>
  res.status(status).json({
    success: false,
    error: { code, message }
  });

export const asyncRoute = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
