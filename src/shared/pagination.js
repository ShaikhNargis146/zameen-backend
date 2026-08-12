const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const parsePagination = (
  query = {},
  { defaultLimit = 20, maxLimit = 100 } = {}
) => {
  const page = clamp(Number.parseInt(query.page, 10) || 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = clamp(Number.parseInt(query.limit, 10) || defaultLimit, 1, maxLimit);
  return { page, limit, offset: (page - 1) * limit };
};

export const paginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0
});
