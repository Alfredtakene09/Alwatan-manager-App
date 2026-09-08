import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
const raw = fs.readFileSync(envPath, "utf8");
if (!/^JWT_SECRET\s*=/m.test(raw)) {
  throw new Error("JWT_SECRET introuvable dans backend/.env");
}
const secret = crypto.randomBytes(48).toString("hex");
const updated = raw.replace(/JWT_SECRET\s*=\s*"[^"]*"/, `JWT_SECRET="${secret}"`);
if (updated.includes("changez-ce-secret")) {
  throw new Error("Le placeholder JWT est encore présent après remplacement");
}
fs.writeFileSync(envPath, updated, "utf8");
process.stdout.write("JWT_SECRET remplace (valeur non affichee).\n");
