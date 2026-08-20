const propertySections = Object.freeze([
  {
    key: "land_details",
    label: "Land details",
    missingLabel: "Land details",
    maxScore: 25
  },
  {
    key: "location",
    label: "Property location",
    missingLabel: "Property location",
    maxScore: 25
  },
  {
    key: "parcel_identifiers",
    label: "Parcel identifiers",
    missingLabel: "Parcel identifier",
    maxScore: 15
  },
  {
    key: "documents",
    label: "Property documents",
    missingLabel: "Property document",
    maxScore: 20
  },
  {
    key: "media",
    label: "Property media",
    missingLabel: "Property media",
    maxScore: 15
  }
]);

const severityFor = label =>
  ["Parcel identifier", "Property document"].includes(label)
    ? "HIGH"
    : "MEDIUM";

export const scannerPresentation = ({
  propertyId,
  readinessScore,
  missingItems = []
}) => {
  const missing = new Set(missingItems);
  return {
    propertyId,
    readinessScore: Number(readinessScore) || 0,
    sections: propertySections.map(section => {
      const isMissing = missing.has(section.missingLabel);
      return {
        key: section.key,
        label: section.label,
        score: isMissing ? 0 : section.maxScore,
        maxScore: section.maxScore,
        status: isMissing ? "MISSING" : "COMPLETE"
      };
    }),
    missingItems: [...missing].map(label => ({
      code: label.toUpperCase().replace(/\s+/g, "_"),
      label,
      severity: severityFor(label)
    })),
    disclaimer:
      "Scanner Lite is a rule-based completeness score. It is not a legal, title, survey, or investment opinion.",
    generatedAt: new Date().toISOString()
  };
};
