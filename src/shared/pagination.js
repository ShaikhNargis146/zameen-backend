const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const parsePagination = (
  query = {},
  { defaultLimit = 20, maxLimit = 100, maxPage = 10000 } = {}
) => {
  const page = clamp(Number.parseInt(query.page, 10) || 1, 1, maxPage);
  const limit = clamp(Number.parseInt(query.limit, 10) || defaultLimit, 1, maxLimit);
  return { page, limit, offset: (page - 1) * limit };
};

export const paginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0
});

/**
 * Splits rows carrying a `count(*) OVER()` window column (aliased "total")
 * back into plain rows + the total count, for list queries that fetch data
 * and the pagination total in a single round trip.
 */
export const splitCountedRows = rows => {
  const total = rows.length ? Number(rows[0].total) : 0;
  const data = rows.map(({ total: _total, ...rest }) => rest);
  return { data, total };
};
