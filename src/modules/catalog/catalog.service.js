import { HttpError } from "../../shared/http.js";
import * as repository from "./catalog.repository.js";

export const listMaster = repository.listMaster;
export const areaUnits = repository.listAreaUnits;
export const amenities = repository.listAmenities;
export const parcelConfig = async stateCode => ({
  stateCode,
  supportedIdentifiers: await repository.listParcelConfig(stateCode),
  notes: null
});
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
export const geocode = async input =>
  (await repository.geocode(input)).map(location => ({
    latitude: location.latitude,
    longitude: location.longitude,
    formattedAddress: location.displayPath,
    locationId: location.id,
    pincode: null
  }));
export const reverseGeocode = async input => {
  const location = await repository.reverseGeocode(input);
  if (!location)
    throw new HttpError(
      404,
      "LOCATION_NOT_FOUND",
      "No location was found for these coordinates."
    );
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    formattedAddress: location.displayPath,
    locationId: location.id,
    pincode: null
  };
};
