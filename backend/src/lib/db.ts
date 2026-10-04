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

const basePrisma = new PrismaClient();

/** Client applicatif : suppressions autorisées uniquement dans le contexte API / startup / script confirmé. */
export const prisma = extendPrismaWithDeleteGuard(basePrisma);

/** Client brut (sans garde Node) — réservé à l’installation des triggers au démarrage. */
export const prismaRaw = basePrisma;
