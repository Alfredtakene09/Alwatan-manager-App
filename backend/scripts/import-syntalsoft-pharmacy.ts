/**
 * Importe le catalogue pharmacie depuis le fichier Excel Syntalsoft
 * (racine du projet : "Syntalsoft Farmacy liste des produits en stock.xlsx").
 *
 * Colonnes : Nº | Produit | Date Exp. | Qté Rayon | P. Achat | P. Vente
 * Les champs absents du fichier (dosage, forme, catégorie, code-barres…) restent vides.
 *
 * Usage :
 *   npx tsx scripts/import-syntalsoft-pharmacy.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { prisma } from "../src/lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "Syntalsoft Farmacy liste des produits en stock.xlsx",
);

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

async function main() {
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Fichier Excel sans feuille");
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], {
    defval: null,
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row.Produit?.toString().trim();
    if (!name) {
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
    const quantity = parseQty(row["Qté Rayon"]);
    const expiryDate = parseExpiryDate(row["Date Exp."]);

    const data = {
      name,
      quantity,
      unitPriceFcfa: unitPriceFcfa > 0 ? unitPriceFcfa : 0,
      purchasePriceFcfa: purchasePriceFcfa != null && purchasePriceFcfa > 0 ? purchasePriceFcfa : null,
      expiryDate,
      noExpiry: !expiryDate,
      minStock: 10,
      active: true,
    };

    const existing = await prisma.product.findUnique({ where: { sku } });
    if (existing) {
      await prisma.product.update({ where: { sku }, data });
      updated += 1;
    } else {
      await prisma.product.create({ data: { ...data, sku } });
      created += 1;
    }
  }

  const total = await prisma.product.count();
  console.log(
    JSON.stringify(
      {
        file: EXCEL_PATH,
        created,
        updated,
        skipped,
        productsInDb: total,
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
