// utils/pdf_text.js
import logger from "./logger.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Try extracting text using Poppler's pdftotext.
 * This is extremely reliable for many PDFs where pdfjs returns empty.
 *
 * Requirements: `pdftotext` must be installed in the runtime (poppler-utils).
 */
export async function extractTextWithPdfToText(pdfBuffer) {
  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(
    tmpDir,
    `ingest_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}.pdf`
  );

  try {
    await writeFile(tmpPdf, pdfBuffer);

    // -layout preserves line breaks better (helps structure + citations)
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", tmpPdf, "-"],
      {
        maxBuffer: 50 * 1024 * 1024
      }
    );

    const text = (stdout || "").trim();
    return text;
  } catch (err) {
    // If pdftotext not installed, this will throw ENOENT
    logger.warn("pdftotext extraction failed (maybe not installed)", {
      error: String(err?.message || err)
    });
    return "";
  } finally {
    // best-effort cleanup
    await unlink(tmpPdf).catch(() => null);
  }
}
