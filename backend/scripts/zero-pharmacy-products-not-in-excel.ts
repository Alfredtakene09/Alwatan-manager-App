/**
 * Met en rupture de stock (qté = 0) les produits actifs absents du fichier Excel Syntalsoft.
 * Usage: npx tsx scripts/zero-pharmacy-products-not-in-excel.ts [--dry-run]
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

type ExcelRow = {
  "Nº"?: number | string | null;
  Produit?: string | null;
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
  throw new Error("Aucun utilisateur ADMIN ou GESTIONNAIRE actif.");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const excelPath = process.argv.find((a) => !a.startsWith("-") && a.endsWith(".xlsx"))
    ? path.resolve(process.argv.find((a) => a.endsWith(".xlsx"))!)
    : DEFAULT_EXCEL_PATH;

  const workbook = XLSX.readFile(excelPath);
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[workbook.SheetNames[0]!], {
    defval: null,
  });

  const excelSkus = new Set<string>();
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
    excelSkus.add(skuFromRow(Number.isFinite(num as number) ? (num as number) : null, name, i));
  }

  const dbProducts = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, sku: true, name: true, quantity: true },
  });

  const notInExcel = dbProducts.filter((p) => !excelSkus.has(p.sku));
  const importUserId = dryRun ? null : await resolveImportUserId();

  const adjusted: Array<{ sku: string; name: string; before: number }> = [];
  const alreadyOut: Array<{ sku: string; name: string }> = [];

  for (const product of notInExcel) {
    if (product.quantity === 0) {
      alreadyOut.push({ sku: product.sku, name: product.name });
      continue;
    }

    adjusted.push({ sku: product.sku, name: product.name, before: product.quantity });

    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        await applyStockMovement(tx, {
          productId: product.id,
          type: "ADJUSTMENT",
          targetQuantity: 0,
          userId: importUserId!,
          reference: "RUPTURE-HORS-CATALOGUE",
          notes: "Produit conservé au catalogue mais absent du fichier Syntalsoft — mise en rupture de stock",
        });
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        excelPath,
        productsNotInExcel: notInExcel.length,
        setToZero: adjusted.length,
        alreadyAtZero: alreadyOut.length,
        adjusted,
        alreadyOut,
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
