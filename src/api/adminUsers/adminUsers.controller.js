import AdminUsersService from "./adminUsers.service.js";

const AdminUsersController = {
  createAdmin: async (req, res) => {
    const actor = req.user;
    const { full_name, phone, email } = req.body || {};

    const r = await AdminUsersService.createAdmin({
      actor,
      full_name,
      phone,
      email
    });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "Admin created", data: r.data });
  }
};

export default AdminUsersController;
