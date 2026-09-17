import { ok } from "../../shared/http.js";
import * as service from "./admin-dashboard.service.js";

export const summary = async (req, res) => ok(res, await service.summary());
