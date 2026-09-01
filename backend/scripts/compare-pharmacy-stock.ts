/**
 * Compare le fichier Excel Syntalsoft avec le stock en base.
 * Usage: npx tsx scripts/compare-pharmacy-stock.ts [chemin-excel]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { prisma } from "../src/lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ExcelRow = {
  "Nº"?: number | string | null;
  Produit?: string | null;
  "Qté Rayon"?: number | string | null;
};

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

function parseQty(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/\s/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

async function main() {
  const excelPath =
    process.argv[2] ??
    path.resolve(
      __dirname,
      "..",
      "..",
      "Syntalsoft Farmacy liste des produits en stock.xlsx",
    );

  const workbook = XLSX.readFile(excelPath);
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[workbook.SheetNames[0]!], {
    defval: null,
  });

  const excelBySku = new Map<string, { name: string; quantity: number }>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const name = row.Produit?.toString().trim();
    if (!name) continue;
    const numRaw = row["Nº"];
    const num =
      typeof numRaw === "number"
        ? numRaw
        : typeof numRaw === "string" && numRaw.trim()
          ? Number(numRaw.replace(/\s/g, ""))
          : null;
    const sku = skuFromRow(Number.isFinite(num as number) ? (num as number) : null, name, i);
    excelBySku.set(sku, { name, quantity: parseQty(row["Qté Rayon"]) });
  }

  const dbProducts = await prisma.product.findMany({
    where: { active: true },
    select: { sku: true, name: true, quantity: true },
  });
  const dbBySku = new Map(dbProducts.map((p) => [p.sku, p]));

  const qtyDiffs: Array<{ sku: string; name: string; dbQty: number; excelQty: number }> = [];
  const onlyExcel: string[] = [];
  const onlyDb: string[] = [];

  for (const [sku, excel] of excelBySku) {
    const db = dbBySku.get(sku);
    if (!db) {
      onlyExcel.push(`${sku} — ${excel.name} (q=${excel.quantity})`);
      continue;
    }
    if (db.quantity !== excel.quantity) {
      qtyDiffs.push({ sku, name: excel.name, dbQty: db.quantity, excelQty: excel.quantity });
    }
  }

  for (const [sku, db] of dbBySku) {
    if (!excelBySku.has(sku)) {
      onlyDb.push(`${sku} — ${db.name} (q=${db.quantity})`);
    }
  }

  const excelTotal = [...excelBySku.values()].reduce((s, p) => s + p.quantity, 0);
  const dbTotal = dbProducts.reduce((s, p) => s + p.quantity, 0);

  console.log(
    JSON.stringify(
      {
        excelPath,
        excelProducts: excelBySku.size,
        dbActiveProducts: dbProducts.length,
        excelTotalQty: excelTotal,
        dbTotalQty: dbTotal,
        quantityMismatches: qtyDiffs.length,
        onlyInExcel: onlyExcel.length,
        onlyInDb: onlyDb.length,
        sampleQtyDiffs: qtyDiffs.slice(0, 20),
        onlyExcelSample: onlyExcel.slice(0, 10),
        onlyDbSample: onlyDb.slice(0, 10),
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
