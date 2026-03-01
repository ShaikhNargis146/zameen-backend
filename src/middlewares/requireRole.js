export const requireRole = (...roles) => (req, res, next) => {
  const actor = req.user || req.admin_user || null;
  const role = actor?.role;
  if (!role || !roles.includes(role)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};
