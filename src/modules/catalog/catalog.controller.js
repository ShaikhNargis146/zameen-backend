import { ok } from "../../shared/http.js";
import * as service from "./catalog.service.js";
import { searchQuery, stateCode } from "./catalog.validation.js";

export const master = key => async (_req, res) =>
  ok(res, await service.listMaster(key));
export const parcelConfig = async (req, res) =>
  ok(res, await service.parcelConfig(stateCode(req.params.stateCode)));
export const searchLocations = async (req, res) =>
  ok(res, await service.searchLocations(searchQuery(req.query)));
export const pincodeLocations = async (req, res) =>
  ok(res, await service.pincodeLocations(req.params.pincode));
export const states = async (_req, res) => ok(res, await service.states());
export const children = async (req, res) =>
  ok(res, await service.children(req.params.locationId));
export const location = async (req, res) =>
  ok(res, await service.location(req.params.locationId));
