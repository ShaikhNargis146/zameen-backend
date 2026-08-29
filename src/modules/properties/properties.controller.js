import { created, ok, paginationMeta } from "../../shared/http.js";
import * as service from "./properties.service.js";
import * as validation from "./properties.validation.js";

export const create = async (req, res) =>
  created(
    res,
    await service.create({
      actorId: req.actor.id,
      input: validation.createProperty(req.body || {})
    })
  );
export const get = async (req, res) =>
  ok(res, await service.get(req.property.id));
export const remove = async (req, res) => {
  await service.remove(req.property.id);
  return res.status(204).send();
};
export const listMine = async (req, res) => {
  const input = validation.propertyList(req.query);
  const result = await service.listMine({ actorId: req.actor.id, input });
  return ok(
    res,
    result.items,
    paginationMeta({
      page: input.page,
      limit: input.limit,
      total: result.total
    })
  );
};
export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      propertyId: req.property.id,
      changes: validation.updateProperty(req.body || {})
    })
  );
export const landDetails = async (req, res) =>
  ok(res, await service.getLandDetails(req.property.id));
export const saveLandDetails = async (req, res) =>
  ok(
    res,
    await service.saveLandDetails({
      propertyId: req.property.id,
      input: validation.landDetails(req.body || {})
    })
  );
export const location = async (req, res) =>
  ok(res, await service.getLocation(req.property.id));
export const saveLocation = async (req, res) =>
  ok(
    res,
    await service.saveLocation({
      propertyId: req.property.id,
      input: validation.propertyLocation(req.body || {})
    })
  );
export const amenities = async (req, res) =>
  ok(res, await service.getAmenities(req.property.id));
export const saveAmenities = async (req, res) =>
  ok(
    res,
    await service.saveAmenities({
      propertyId: req.property.id,
      amenities: validation.amenities(req.body || {})
    })
  );
export const identifiers = async (req, res) =>
  ok(res, await service.getIdentifiers(req.property.id));
export const saveIdentifiers = async (req, res) =>
  ok(
    res,
    await service.saveIdentifiers({
      propertyId: req.property.id,
      identifiers: validation.identifiers(req.body || {})
    })
  );
export const requestVerification = async (req, res) =>
  created(
    res,
    await service.requestVerification({
      propertyId: req.property.id,
      actorId: req.actor.id,
      ...validation.verificationRequest(req.body || {})
    })
  );
export const verification = async (req, res) =>
  ok(res, await service.verificationSummary(req.property.id));
export const scanner = async (req, res) =>
  ok(res, await service.scanner(req.property.id));
export const passport = async (req, res) =>
  ok(res, await service.passport(req.property.id));
export const mediaUpload = async (req, res) =>
  ok(
    res,
    await service.createMediaUpload({
      propertyId: req.property.id,
      input: validation.mediaUpload(req.body || {})
    })
  );
export const completeMedia = async (req, res) =>
  created(
    res,
    await service.completeMedia({
      propertyId: req.property.id,
      actorId: req.actor.id,
      input: validation.mediaComplete(req.body || {})
    })
  );
export const media = async (req, res) =>
  ok(res, await service.listMedia(req.property.id));
export const updateMedia = async (req, res) =>
  ok(
    res,
    await service.updateMedia({
      propertyId: req.property.id,
      mediaId: req.params.mediaId,
      changes: validation.mediaUpdate(req.body || {})
    })
  );
export const deleteMedia = async (req, res) => {
  await service.deleteMedia({
    propertyId: req.property.id,
    mediaId: req.params.mediaId
  });
  return res.status(204).send();
};
export const orderMedia = async (req, res) =>
  ok(
    res,
    await service.reorderMedia({
      propertyId: req.property.id,
      mediaIds: validation.mediaOrder(req.body || {})
    })
  );
export const coverMedia = async (req, res) =>
  ok(
    res,
    await service.setMediaCover({
      propertyId: req.property.id,
      mediaId: req.params.mediaId
    })
  );
export const documentUpload = async (req, res) =>
  ok(
    res,
    await service.createDocumentUpload({
      propertyId: req.property.id,
      input: validation.documentUpload(req.body || {})
    })
  );
export const completeDocument = async (req, res) =>
  created(
    res,
    await service.completeDocument({
      propertyId: req.property.id,
      actorId: req.actor.id,
      input: validation.documentComplete(req.body || {})
    })
  );
export const documents = async (req, res) =>
  ok(res, await service.listDocuments(req.property.id));
export const document = async (req, res) =>
  ok(
    res,
    await service.getDocument({
      propertyId: req.params.propertyId,
      documentId: req.params.documentId,
      actor: req.actor
    })
  );
export const documentAccessGrants = async (req, res) =>
  ok(
    res,
    await service.listDocumentAccessGrants({
      propertyId: req.property.id,
      documentId: req.params.documentId
    })
  );
export const grantDocumentAccess = async (req, res) =>
  ok(
    res,
    await service.grantDocumentAccess({
      propertyId: req.property.id,
      documentId: req.params.documentId,
      actorId: req.actor.id,
      input: validation.documentAccessGrant(req.body || {})
    })
  );
export const revokeDocumentAccess = async (req, res) => {
  await service.revokeDocumentAccess({
    propertyId: req.property.id,
    documentId: req.params.documentId,
    grantId: req.params.grantId,
    actorId: req.actor.id
  });
  return res.status(204).send();
};
export const deleteDocument = async (req, res) => {
  await service.deleteDocument({
    propertyId: req.property.id,
    documentId: req.params.documentId
  });
  return res.status(204).send();
};
