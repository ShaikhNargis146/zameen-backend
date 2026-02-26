import logger from "../utils/logger.js";
import db_store from "../utils/postgres_store.js";

const log = async data => {
  try {
    console.log("Inside logging", data);
    const columns = Object.keys(data).map(k => k);
    const params = {
      table: "activity",
      columns: columns,
      values: data
    };
    const response = await db_store.saveOne(params);
    if (!response.error) console.log("saved");
    else console.log("error occured");
  } catch (err) {
    logger.error("error in save_user", err);
  }
};

export default {
  log
};
