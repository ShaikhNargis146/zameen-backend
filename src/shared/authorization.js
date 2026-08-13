export const requireOwnedResource = ({ param, target, load }) => async (
  req,
  res,
  next
) => {
  try {
    req[target] = await load(req.params[param], req.actor?.id || null);
    return next();
  } catch (error) {
    return next(error);
  }
};
