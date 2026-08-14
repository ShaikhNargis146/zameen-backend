export const requireOwnedResource = ({
  param,
  target,
  load,
  loadForAdmin = null
}) => async (req, res, next) => {
  try {
    req[target] =
      loadForAdmin && req.actor?.roles?.includes("ADMIN")
        ? await loadForAdmin(req.params[param])
        : await load(req.params[param], req.actor?.id || null);
    return next();
  } catch (error) {
    return next(error);
  }
};
