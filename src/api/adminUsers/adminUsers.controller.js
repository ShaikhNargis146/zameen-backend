import httpStatus from "http-status";
import AdminUsersService from "./adminUsers.service.js";

const listAdmins = async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const search = req.query.search || null;
    const role = req.query.role || null; // admin|super_admin
    const status = req.query.status || null; // active|blocked|inactive

    const response = await AdminUsersService.list({
      limit,
      offset,
      search,
      role,
      status
    });

    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const createAdmin = async (req, res, next) => {
  try {
    const actor = req.admin_user; // set by admin_auth middleware
    const response = await AdminUsersService.create({ data: req.body, actor });

    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const patchAdminStatus = async (req, res, next) => {
  try {
    const actor = req.admin_user;
    const id = req.params.id;

    const status = req.body?.status; // active|blocked|inactive

    const response = await AdminUsersService.setStatus({ id, status, actor });

    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};
const summary = async (req, res, next) => {
  try {
    const response = await AdminUsersService.summary();
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

export default { listAdmins, createAdmin, patchAdminStatus, summary };
