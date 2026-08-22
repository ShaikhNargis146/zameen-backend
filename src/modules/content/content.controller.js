import { created, ok } from "../../shared/http.js";
import * as service from "./content.service.js";
import * as validation from "./content.validation.js";

export const listContent = async (req, res) => {
  const { data, meta } = await service.listContent(validation.contentListQuery(req.query || {}));
  ok(res, data, meta);
};

export const contentDetail = async (req, res) =>
  ok(
    res,
    await service.contentBySlug({
      slug: req.params.slug,
      language: validation.optionalLanguage(req.query.language)
    })
  );

export const createContent = async (req, res) =>
  created(
    res,
    await service.createContent({
      actorId: req.actor.id,
      input: validation.createContent(req.body || {})
    })
  );

export const updateContent = async (req, res) =>
  ok(
    res,
    await service.updateContent({
      contentId: validation.uuid(req.params.contentId, "contentId"),
      changes: validation.updateContent(req.body || {})
    })
  );

export const deleteContent = async (req, res) => {
  await service.removeContent(validation.uuid(req.params.contentId, "contentId"));
  res.status(204).send();
};

export const publishContent = async (req, res) =>
  ok(
    res,
    await service.transitionContent({
      contentId: validation.uuid(req.params.contentId, "contentId"),
      action: "publish"
    })
  );

export const archiveContent = async (req, res) =>
  ok(
    res,
    await service.transitionContent({
      contentId: validation.uuid(req.params.contentId, "contentId"),
      action: "archive"
    })
  );

export const marketTrends = async (req, res) =>
  ok(res, await service.listMarketTrends(validation.marketTrendQuery(req.query || {})));

export const createSeries = async (req, res) =>
  created(res, await service.createSeries(validation.createSeries(req.body || {})));

export const updateSeries = async (req, res) =>
  ok(
    res,
    await service.updateSeries({
      seriesId: validation.uuid(req.params.seriesId, "seriesId"),
      changes: validation.updateSeries(req.body || {})
    })
  );

export const deleteSeries = async (req, res) => {
  await service.removeSeries(validation.uuid(req.params.seriesId, "seriesId"));
  res.status(204).send();
};

export const addPoint = async (req, res) =>
  created(
    res,
    await service.addPoint({
      seriesId: validation.uuid(req.params.seriesId, "seriesId"),
      input: validation.pointInput(req.body || {})
    })
  );

export const updatePoint = async (req, res) =>
  ok(
    res,
    await service.updatePoint({
      seriesId: validation.uuid(req.params.seriesId, "seriesId"),
      pointId: validation.uuid(req.params.pointId, "pointId"),
      input: validation.pointInput(req.body || {})
    })
  );

export const deletePoint = async (req, res) => {
  await service.removePoint({
    seriesId: validation.uuid(req.params.seriesId, "seriesId"),
    pointId: validation.uuid(req.params.pointId, "pointId")
  });
  res.status(204).send();
};
