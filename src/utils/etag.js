import crypto from "node:crypto";
export const etagFrom = (input) =>
  '"' +
  crypto.createHash("sha1").update(JSON.stringify(input)).digest("hex") +
  '"';
