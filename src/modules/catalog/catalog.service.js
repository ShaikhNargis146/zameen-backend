import { HttpError } from "../../shared/http.js";
import * as repository from "./catalog.repository.js";

export const listMaster = repository.listMaster;
export const parcelConfig = repository.listParcelConfig;
export const searchLocations = repository.searchLocations;
export const pincodeLocations = repository.locationsForPincode;
export const states = repository.listStates;
export const children = repository.childrenForLocation;
export const location = async id => {
  const result = await repository.findLocation(id);
  if (!result)
    throw new HttpError(404, "LOCATION_NOT_FOUND", "Location was not found.");
  return result;
};
