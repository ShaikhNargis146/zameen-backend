import pg from "../utils/postgres_store.js";

export const run = async (method, sql, params = []) => {
  const result = await pg[method](sql, params);
  if (!result.ok) throw result.error;
  return result.data;
};

export { pg };
