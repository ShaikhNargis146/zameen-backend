// Pure GST math for the invoice tax breakdown (see
// migrations/014_invoice_gst_fields.sql). amount_minor everywhere in
// commerce is already GST-inclusive — this only ever back-calculates a
// display split, it never changes what a customer is charged. Kept
// dependency-free (no repository/service imports) so both
// commerce.repository.js and commerce.service.js can import it without a
// circular dependency.

export const stateCodeFromGstin = gstin => (gstin ? String(gstin).trim().slice(0, 2) : null);

// gstRateBps is basis points (1800 = 18%). Any remainder paisa from the
// intra-state 50/50 split is given to CGST, deterministically.
export const splitGstMinor = ({ totalAmountMinor, gstRateBps, isIntraState }) => {
  const total = Number(totalAmountMinor);
  const rate = Number(gstRateBps);
  const baseMinor = Math.round((total * 10000) / (10000 + rate));
  const gstMinor = total - baseMinor;
  if (isIntraState) {
    const sgstMinor = Math.floor(gstMinor / 2);
    return { baseMinor, cgstMinor: gstMinor - sgstMinor, sgstMinor, igstMinor: 0 };
  }
  return { baseMinor, cgstMinor: 0, sgstMinor: 0, igstMinor: gstMinor };
};
