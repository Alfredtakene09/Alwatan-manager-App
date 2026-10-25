import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { extendPrismaWithDeleteGuard } from "./db-delete-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env");
const envLanPath = path.resolve(__dirname, "../../.env.lan");
dotenv.config({ path: envPath, override: true });
// HOST, CORS et mode d'accès : fichier séparé, pour ne jamais réécrire les secrets de .env.
dotenv.config({ path: envLanPath, override: true });

/**
 * Tests d'intégration : base et port dédiés, jamais la base de travail.
 * Le nom de la base doit se terminer par « _test », sinon on refuse de démarrer.
 */
const testDatabaseUrl = process.env.ALWATAN_TEST_DATABASE_URL?.trim();
if (testDatabaseUrl) {
  const dbName = new URL(testDatabaseUrl).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`ALWATAN_TEST_DATABASE_URL doit viser une base « *_test » (reçu : ${dbName}).`);
  }
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.PORT = process.env.ALWATAN_TEST_PORT?.trim() || "4100";
  process.env.HOST = "127.0.0.1";
  process.env.BACKUP_ENABLED = "0";
  process.env.SERVE_FRONTEND = "0";
  process.env.AUTO_BUILD_FRONTEND = "0";
}

const basePrisma = new PrismaClient();

/** Client applicatif : suppressions autorisées uniquement dans le contexte API / startup / script confirmé. */
export const prisma = extendPrismaWithDeleteGuard(basePrisma);

/** Client brut (sans garde Node) — réservé à l’installation des triggers au démarrage. */
export const prismaRaw = basePrisma;
