export const LGD_SOURCE = "LGD";

export const locationTypes = Object.freeze({
  states: "STATE",
  districts: "DISTRICT",
  subdistricts: "SUBDISTRICT",
  villages: "VILLAGE"
});

// The UI contract uses the familiar two-letter Indian state/UT codes (for
// example, MH). LGD exports numeric codes, so this is the explicit mapping
// between the authoritative source and the API contract.
const stateCodeByLgdCode = Object.freeze({
  "1": "JK",
  "2": "HP",
  "3": "PB",
  "4": "CH",
  "5": "UK",
  "6": "HR",
  "7": "DL",
  "8": "RJ",
  "9": "UP",
  "10": "BR",
  "11": "SK",
  "12": "AR",
  "13": "NL",
  "14": "MN",
  "15": "MZ",
  "16": "TR",
  "17": "ML",
  "18": "AS",
  "19": "WB",
  "20": "JH",
  "21": "OD",
  "22": "CT",
  "23": "MP",
  "24": "GJ",
  "27": "MH",
  "28": "AP",
  "29": "KA",
  "30": "GA",
  "31": "LD",
  "32": "KL",
  "33": "TN",
  "34": "PY",
  "35": "AN",
  "36": "TS",
  "37": "LA",
  "38": "DH"
});

export const stateCodeForLgd = value => stateCodeByLgdCode[String(value)];

// geo.locations has no separate external-reference table in the initial
// baseline. These reserved, code-based slugs are stable LGD import identities;
// they are not exposed by the location API.
export const lgdSlug = (type, code) =>
  `${LGD_SOURCE.toLowerCase()}-${String(type).toLowerCase()}-${String(code)}`;
