export const toField = code =>
  /^[A-Z0-9_]+$/.test(code) ? code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()) : code;
