import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "StockMovementType" AS ENUM ('ENTRY', 'EXIT', 'ADJUSTMENT', 'DISPENSATION');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PharmacySupplier" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "contactName" TEXT,
      "phone" TEXT,
      "email" TEXT,
      "address" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PharmacySupplier_name_idx" ON "PharmacySupplier"("name");`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductCategory" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProductCategory_sortOrder_idx" ON "ProductCategory"("sortOrder");`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PharmacyExternalClient" (
      "id" TEXT PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "firstName" TEXT NOT NULL,
      "lastName" TEXT NOT NULL,
      "phone" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PharmacyExternalClient_lastName_firstName_idx" ON "PharmacyExternalClient"("lastName", "firstName");`,
  );

  // Product columns
  const productAlters = [
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barcode" TEXT`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "dosage" TEXT`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "pharmaceuticalForm" TEXT`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "categoryId" TEXT`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supplierId" TEXT`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "expiryDate" DATE`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "noExpiry" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sachetsPerBox" INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sachetPriceFcfa" INTEGER`,
    `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sellBySachet" BOOLEAN NOT NULL DEFAULT false`,
  ];
  for (const sql of productAlters) {
    await prisma.$executeRawUnsafe(sql);
  }

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Product" ADD CONSTRAINT "Product_barcode_key" UNIQUE ("barcode");
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey"
        FOREIGN KEY ("supplierId") REFERENCES "PharmacySupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Product_categoryId_idx" ON "Product"("categoryId");`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Product_supplierId_idx" ON "Product"("supplierId");`,
  );

  // Prescription: patientId optional + externalClientId
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Prescription" ALTER COLUMN "patientId" DROP NOT NULL`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "externalClientId" TEXT`,
  );
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_externalClientId_fkey"
        FOREIGN KEY ("externalClientId") REFERENCES "PharmacyExternalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Prescription_patientId_idx" ON "Prescription"("patientId");`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Prescription_externalClientId_idx" ON "Prescription"("externalClientId");`,
  );

  // Invoice: patientId optional + externalClientId
  await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ALTER COLUMN "patientId" DROP NOT NULL`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "externalClientId" TEXT`,
  );
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_externalClientId_fkey"
        FOREIGN KEY ("externalClientId") REFERENCES "PharmacyExternalClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Invoice_externalClientId_idx" ON "Invoice"("externalClientId");`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "StockMovement" (
      "id" TEXT PRIMARY KEY,
      "productId" TEXT NOT NULL,
      "type" "StockMovementType" NOT NULL,
      "quantity" INTEGER NOT NULL,
      "unitCostFcfa" INTEGER,
      "supplierId" TEXT,
      "reference" TEXT,
      "notes" TEXT,
      "prescriptionId" TEXT,
      "userId" TEXT NOT NULL,
      "stockAfter" INTEGER NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "StockMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "PharmacySupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "StockMovement_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");`,
  );

  console.log("Migration pharmacie appliquée.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
