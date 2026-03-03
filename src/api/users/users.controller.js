import httpStatus from "http-status";
import UsersService from "./users.service.js";

const listUsers = async (req, res, next) => {
  try {
    const scope = req.query.scope || "app";
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const search = req.query.search || null;
    const role = req.query.role || null;
    const status = req.query.status || null;
    const org_id = req.query.org_id || null;

    const response = await UsersService.list({
      scope,
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

const createUser = async (req, res, next) => {
  try {
    const actor = req.admin_user;
    const scope = req.body?.scope || "app";
    const response = await UsersService.create({
      scope,
      data: req.body,
      actor
    });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const patchUserStatus = async (req, res, next) => {
  try {
    const actor = req.admin_user;
    const id = req.params.id;
    const scope = req.body?.scope || "app";
    const status = req.body?.status;

    const response = await UsersService.setStatus({ scope, id, status, actor });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const summary = async (req, res, next) => {
  try {
    const response = await UsersService.summary();
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

export default { listUsers, createUser, patchUserStatus, summary };
