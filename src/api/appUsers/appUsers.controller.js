import httpStatus from "http-status";
import AppUsersService from "./appUsers.service.js";

const listAppUsers = async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const search = req.query.search || null;
    const role = req.query.role || null;
    const status = req.query.status || null;
    const org_id = req.query.org_id || null;

    const response = await AppUsersService.list({
      limit,
      offset,
      search,
      role,
      status,
      org_id
    });

    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const createAppUser = async (req, res, next) => {
  try {
    const actor = req.admin_user;
    const response = await AppUsersService.create({ data: req.body, actor });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const patchAppUserStatus = async (req, res, next) => {
  try {
    const actor = req.admin_user;
    const id = req.params.id;
    const status = req.body?.status;

    const response = await AppUsersService.setStatus({ id, status, actor });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

export default { listAppUsers, createAppUser, patchAppUserStatus };
