/**
 * Synchronise le catalogue pharmacie depuis le fichier Excel Syntalsoft.
 * Par défaut : racine du projet — "Syntalsoft Farmacy liste des produits en stock.xlsx".
 *
 * Colonnes : Nº | Produit | Date Exp. | Qté Rayon | P. Achat | P. Vente
 * Les champs absents du fichier (dosage, forme, catégorie, code-barres…) restent inchangés.
 *
 * Usage :
 *   npx tsx scripts/import-syntalsoft-pharmacy.ts [chemin-excel] [--dry-run]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { prisma } from "../src/lib/db.js";
import { applyStockMovement } from "../src/lib/pharmacy-stock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXCEL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "Syntalsoft Farmacy liste des produits en stock.xlsx",
);

const SUMMARY_NAME_PATTERN = /^(totaux?|total|sous[-\s]?total|grand\s*total)$/i;

type ExcelRow = {
  "Nº"?: number | string | null;
  Produit?: string | null;
  "Date Exp."?: string | number | Date | null;
  "Qté Rayon"?: number | string | null;
  "P. Achat"?: number | string | null;
  "P. Vente"?: number | string | null;
};

function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const normalized = String(value)
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseQty(value: unknown): number {
  const n = parseMoney(value);
  return n != null && n >= 0 ? n : 0;
}

/** Accepte JJ/MM/AAAA ou numéro de série Excel. */
function parseExpiryDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  const text = String(value).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function skuFromRow(num: number | null, name: string, index: number): string {
  if (num != null && Number.isFinite(num) && num > 0) {
    return `SYN-${String(Math.trunc(num)).padStart(4, "0")}`;
  }
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `SYN-${slug || "PRODUIT"}-${String(index + 1).padStart(4, "0")}`;
}

function isSummaryRow(name: string): boolean {
  return SUMMARY_NAME_PATTERN.test(name.trim());
}

async function resolveImportUserId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (admin) return admin.id;
  const gestionnaire = await prisma.user.findFirst({
    where: { role: "GESTIONNAIRE", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (gestionnaire) return gestionnaire.id;
  throw new Error("Aucun utilisateur ADMIN ou GESTIONNAIRE actif pour tracer les ajustements de stock.");
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
  const dryRun = process.argv.includes("--dry-run");
  const excelPath = args[0] ? path.resolve(args[0]) : DEFAULT_EXCEL_PATH;

  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Fichier Excel sans feuille");
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], {
    defval: null,
  });

  const importUserId = dryRun ? null : await resolveImportUserId();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let stockAdjusted = 0;
  const quantityChanges: Array<{
    sku: string;
    name: string;
    before: number;
    after: number;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.Produit?.toString().trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    if (isSummaryRow(name)) {
      skipped += 1;
      continue;
    }

    const numRaw = row["Nº"];
    const num =
      typeof numRaw === "number"
        ? numRaw
        : typeof numRaw === "string" && numRaw.trim()
          ? Number(numRaw.replace(/\s/g, ""))
          : null;
    const sku = skuFromRow(Number.isFinite(num as number) ? (num as number) : null, name, i);
    const unitPriceFcfa = parseMoney(row["P. Vente"]) ?? 0;
    const purchasePriceFcfa = parseMoney(row["P. Achat"]);
    const targetQuantity = parseQty(row["Qté Rayon"]);
    const expiryDate = parseExpiryDate(row["Date Exp."]);

    const catalogData = {
      name,
      unitPriceFcfa: unitPriceFcfa > 0 ? unitPriceFcfa : 0,
      purchasePriceFcfa: purchasePriceFcfa != null && purchasePriceFcfa > 0 ? purchasePriceFcfa : null,
      expiryDate,
      noExpiry: !expiryDate,
      minStock: 10,
      active: true,
    };

    const existing = await prisma.product.findUnique({ where: { sku } });

    if (dryRun) {
      if (existing) {
        updated += 1;
        if (existing.quantity !== targetQuantity) {
          stockAdjusted += 1;
          quantityChanges.push({
            sku,
            name,
            before: existing.quantity,
            after: targetQuantity,
          });
        }
      } else {
        created += 1;
      }
      continue;
    }

    if (existing) {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { sku },
          data: catalogData,
        });

        if (existing.quantity !== targetQuantity) {
          await applyStockMovement(tx, {
            productId: existing.id,
            type: "ADJUSTMENT",
            targetQuantity,
            userId: importUserId!,
            reference: "IMPORT-SYNTALSOFT",
            notes: `Synchronisation inventaire depuis ${path.basename(excelPath)}`,
          });
          stockAdjusted += 1;
          quantityChanges.push({
            sku,
            name,
            before: existing.quantity,
            after: targetQuantity,
          });
        }
      });
      updated += 1;
    } else {
      await prisma.product.create({
        data: { ...catalogData, sku, quantity: targetQuantity },
      });
      created += 1;
    }
  }

  const total = await prisma.product.count();
  console.log(
    JSON.stringify(
      {
        file: excelPath,
        dryRun,
        created,
        updated,
        skipped,
        stockAdjusted,
        quantityChanges,
        productsInDb: total,
        untouchedProductsNotInFile: await prisma.product.count({
          where: {
            active: true,
            NOT: { sku: { startsWith: "SYN-" } },
          },
        }),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
