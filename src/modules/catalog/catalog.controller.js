import { ok } from "../../shared/http.js";
import * as service from "./catalog.service.js";
import {
  coordinates,
  locationSearch,
  searchQuery,
  stateCode
} from "./catalog.validation.js";

export const master = key => async (_req, res) =>
  ok(res, await service.listMaster(key));
export const documentTypes = async (req, res) =>
  ok(
    res,
    await service.documentTypes(
      req.query.stateCode ? stateCode(req.query.stateCode) : null
    )
  );
export const areaUnits = async (req, res) =>
  ok(
    res,
    await service.areaUnits(
      req.query.stateCode ? stateCode(req.query.stateCode) : null
    )
  );
export const amenities = async (req, res) =>
  ok(
    res,
    await service.amenities(
      req.query.category ? String(req.query.category).toUpperCase() : null
    )
  );
export const parcelConfig = async (req, res) =>
  ok(res, await service.parcelConfig(stateCode(req.params.stateCode)));
export const searchLocations = async (req, res) =>
  ok(res, await service.searchLocations(locationSearch(req.query)));
export const pincodeLocations = async (req, res) =>
  ok(res, await service.pincodeLocations(req.params.pincode));
export const states = async (_req, res) => ok(res, await service.states());
export const children = type => async (req, res) =>
  ok(
    res,
    await service.children(
      req.params.locationId ||
        req.params.stateId ||
        req.params.districtId ||
        req.params.cityId,
      type
    )
  );
export const cities = async (req, res) =>
  ok(res, await service.cities(req.params.districtId));
export const localities = async (req, res) =>
  ok(res, await service.localities(req.params.cityId));
export const location = async (req, res) =>
  ok(res, await service.location(req.params.locationId));
export const geocode = async (req, res) =>
  ok(
    res,
    await service.geocode({
      q: searchQuery(req.query),
      limit: Math.min(Math.max(Number(req.query.limit || 10), 1), 25)
    })
  );
export const reverseGeocode = async (req, res) =>
  ok(res, await service.reverseGeocode(coordinates(req.query)));
