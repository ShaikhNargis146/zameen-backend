import { ok } from "../../shared/http.js";
import { TEMPLATE_FILE_NAME } from "./listings.bulk-upload.constants.js";
import * as service from "./listings.bulk-upload.service.js";

export const template = async (req, res) => {
  const buffer = await service.sampleTemplate();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${TEMPLATE_FILE_NAME}"`
  );
  return res.send(buffer);
};
export const upload = async (req, res) =>
  ok(
    res,
    await service.processUpload({
      file: req.file,
      actorId: req.actor.id
    })
  );
