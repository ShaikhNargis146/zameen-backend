import { COLUMNS } from "./listings.bulk-upload.constants.js";

// RFC 4180: only quote a field when it actually needs it, doubling any
// quotes it contains.
const csvField = value => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvRow = values => values.map(csvField).join(",");

export const buildTemplateCsv = () => {
  const lines = [
    csvRow(COLUMNS.map(column => column.key)),
    csvRow(COLUMNS.map(column => column.example)),
    csvRow(COLUMNS.map(column => column.example))
  ];
  // Leading BOM so Excel/Numbers auto-detect UTF-8 instead of guessing a
  // local codepage when the file is opened directly.
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
};
