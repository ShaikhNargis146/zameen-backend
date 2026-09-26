import PDFDocument from "pdfkit";

const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;

const formatMoney = minor => `Rs. ${(Number(minor) / 100).toFixed(2)}`;
const formatDate = value =>
  new Date(value).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });

// Line items on one order share a single place-of-supply decision (it's
// computed once per order, not per item — see capturePaymentAndApplyEntitlements),
// so the whole invoice is either CGST+SGST or IGST, never a mix. That's what
// lets the table below pick one fixed column layout per invoice.
const buildColumns = isIntraState => {
  const taxColumns = isIntraState
    ? [
        { key: "cgstMinor", label: "CGST", width: 55 },
        { key: "sgstMinor", label: "SGST", width: 55 }
      ]
    : [{ key: "igstMinor", label: "IGST", width: 55 }];
  const leading = [
    { key: "name", label: "Description", width: 160 },
    { key: "hsnSacCode", label: "HSN/SAC", width: 60 },
    { key: "quantity", label: "Qty", width: 30 },
    { key: "baseMinor", label: "Taxable Value", width: 75 },
    ...taxColumns
  ];
  const leadingWidth = leading.reduce((sum, col) => sum + col.width, 0);
  const fixed = [...leading, { key: "totalAmountMinor", label: "Total", width: CONTENT_WIDTH - leadingWidth }];
  let x = PAGE_MARGIN;
  return fixed.map(col => {
    const withX = { ...col, x };
    x += col.width;
    return withX;
  });
};

const drawRow = (doc, columns, y, values, { bold = false } = {}) => {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
  for (const col of columns)
    doc.text(String(values[col.key] ?? ""), col.x + 2, y, { width: col.width - 4, align: "left" });
};

// gstRateBps/hsnSacCode on order_items are a snapshot of the product at the
// time this order was created (migrations/014_invoice_gst_fields.sql) —
// stable even if the product's own rate changes later, which is what keeps a
// re-downloaded invoice identical to the one first issued.
export const renderInvoicePdf = ({ seller, order, items }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const isIntraState = Number(order.igstMinor) === 0;

    doc.font("Helvetica-Bold").fontSize(16).text(seller.legalName);
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(seller.address)
      .text(`GSTIN: ${seller.gstin}`);

    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(14).text("TAX INVOICE", { align: "center" });
    doc.moveDown(0.5);

    doc.font("Helvetica").fontSize(9);
    const metaY = doc.y;
    doc.text(`Invoice No: ${order.invoiceNumber}`, PAGE_MARGIN, metaY);
    doc.text(`Invoice Date: ${formatDate(order.paidAt)}`, PAGE_MARGIN, metaY, {
      width: CONTENT_WIDTH,
      align: "right"
    });
    doc.text(`Order No: ${order.orderNumber}`, PAGE_MARGIN, metaY + 14);

    doc.moveDown(2);
    doc.font("Helvetica-Bold").text("Bill To:");
    doc.font("Helvetica");
    doc.text(order.organizationName || order.buyerName);
    if (order.organizationName) doc.text(`Attn: ${order.buyerName}`);
    if (order.buyerEmail) doc.text(order.buyerEmail);
    if (order.buyerPhone) doc.text(order.buyerPhone);
    doc.text(`GSTIN: ${order.buyerGstin || "Unregistered"}`);
    doc.text(`Place of Supply: ${order.placeOfSupplyStateCode || "-"}`);

    doc.moveDown(1.5);
    const columns = buildColumns(isIntraState);
    const tableTop = doc.y;
    drawRow(
      doc,
      columns,
      tableTop,
      Object.fromEntries(columns.map(col => [col.key, col.label])),
      { bold: true }
    );
    doc
      .moveTo(PAGE_MARGIN, tableTop + 14)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, tableTop + 14)
      .stroke();

    let y = tableTop + 20;
    const totals = { baseMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, totalAmountMinor: 0 };
    for (const item of items) {
      drawRow(doc, columns, y, {
        name: item.name,
        hsnSacCode: item.hsnSacCode || "-",
        quantity: item.quantity,
        baseMinor: formatMoney(item.baseMinor),
        cgstMinor: formatMoney(item.cgstMinor || 0),
        sgstMinor: formatMoney(item.sgstMinor || 0),
        igstMinor: formatMoney(item.igstMinor || 0),
        totalAmountMinor: formatMoney(item.totalAmountMinor)
      });
      totals.baseMinor += item.baseMinor;
      totals.cgstMinor += item.cgstMinor || 0;
      totals.sgstMinor += item.sgstMinor || 0;
      totals.igstMinor += item.igstMinor || 0;
      totals.totalAmountMinor += Number(item.totalAmountMinor);
      y += 18;
    }
    doc
      .moveTo(PAGE_MARGIN, y)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
      .stroke();
    y += 6;
    drawRow(
      doc,
      columns,
      y,
      {
        name: "",
        hsnSacCode: "",
        quantity: "",
        baseMinor: formatMoney(totals.baseMinor),
        cgstMinor: formatMoney(totals.cgstMinor),
        sgstMinor: formatMoney(totals.sgstMinor),
        igstMinor: formatMoney(totals.igstMinor),
        totalAmountMinor: formatMoney(totals.totalAmountMinor)
      },
      { bold: true }
    );

    doc.moveDown(4);
    doc
      .font("Helvetica")
      .fontSize(8)
      .text("This is a system-generated invoice.", PAGE_MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: "center"
      });

    doc.end();
  });
