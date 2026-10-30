import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { runWithAppDataDeleteUnlock } from "./db-delete-guard.js";
import {
  collectAuditIds,
  describeAuditAction,
  readableAuditDetails,
  resolveAuditNames,
  type AuditReadableDetails,
} from "./audit-describe.js";

/**
 * Corbeille : chaque bouton « Supprimer » laisse une copie des lignes supprimées
 * (élément principal + éléments supprimés avec lui) dans DeletedRecord, via le trigger PostgreSQL.
 * Un lot = une suppression demandée ; on peut le consulter et le restaurer.
 */

export const TRASH_RETENTION_MONTHS = 2;

const TABLE_LABELS: Record<string, string> = {
  EmployeeJobTitle: "Poste",
  ClinicService: "Service",
  ClinicServiceDoctor: "Médecin d'un service",
  Employee: "Employé",
  User: "Compte utilisateur",
  Patient: "Patient",
  PatientDossier: "Dossier patient",
  PatientDocument: "Document patient",
  Visit: "Visite",
  VitalSign: "Constantes",
  Consultation: "Consultation",
  InterventionType: "Type d'intervention",
  InterventionTypeSurgeon: "Chirurgien d'une intervention",
  ExamCatalogItem: "Examen du catalogue",
  ExamCatalogServiceTab: "Onglet de service",
  LabPanel: "Bilan de laboratoire",
  LabPanelField: "Champ de bilan",
  SurgeryCase: "Opération",
  Room: "Salle / chambre",
  Bed: "Lit",
  Hospitalization: "Hospitalisation",
  Invoice: "Facture",
  InvoicePayment: "Paiement de facture",
  PharmacySupplier: "Fournisseur pharmacie",
  ProductCategory: "Catégorie de produits",
  ProductForm: "Forme de médicament",
  Product: "Produit pharmacie",
  StockMovement: "Mouvement de stock",
  Prescription: "Vente pharmacie",
  PharmacyDayClosure: "Clôture pharmacie",
  PharmacyExternalClient: "Client externe pharmacie",
  PharmacySaleLine: "Ligne de vente",
  PharmacySaleReturn: "Retour de vente",
  ReceptionCashSettlement: "Versement de caisse",
  ReceptionDayClosure: "Clôture de caisse",
  ReceptionCashSettlementLine: "Ligne de versement",
  ClinicExpenseIndice: "Motif de dépense",
  ExpenseCategory: "Catégorie de dépenses",
  ClinicExpense: "Dépense / entrée de caisse",
  EmployeePayroll: "Paie",
  SalaryAdvance: "Avance sur salaire",
  DoctorOvertimeEntry: "Garde de médecin",
  DoctorShareClaim: "Part de médecin",
  CashChangeTransfer: "Remise de monnaie",
  ExamReclamation: "Réclamation d'examen",
  LogisticsCategory: "Catégorie logistique",
  LogisticsSupplier: "Fournisseur logistique",
  LogisticsItem: "Article logistique",
  LogisticsStockMovement: "Mouvement de stock logistique",
  LogisticsRequest: "Demande logistique",
  LogisticsRequestLine: "Ligne de demande logistique",
  LabStockCategory: "Catégorie stock laboratoire",
  LabStockItem: "Article stock laboratoire",
  LabStockMovement: "Mouvement stock laboratoire",
};

const MODEL_NAMES = new Set<string>(Object.values(Prisma.ModelName));
const ID_IN_PATH = /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i;
/** Colonnes techniques masquées dans le détail. */
const HIDDEN_COLUMNS = new Set(["id", "updatedAt", "passwordHash", "sessionTokenId", "hiddenUiActions"]);

type TrashRow = {
  id: string;
  batchId: string;
  tableName: string;
  rowId: string | null;
  data: Prisma.JsonValue;
  actorId: string | null;
  requestPath: string | null;
  deletedAt: Date;
  restoredAt: Date | null;
  restoredById: string | null;
};

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Nom affichable d'une ligne supprimée (nom, libellé, personne, numéro…). */
function titleOf(data: Record<string, unknown>, names: Map<string, string>): string {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const person = [text(data.firstName), text(data.lastName)].filter(Boolean).join(" ");
  const base =
    text(data.name) ??
    text(data.label) ??
    (person || null) ??
    (text(data.invoiceNumber) ? `n° ${data.invoiceNumber}` : null) ??
    text(data.title) ??
    text(data.code) ??
    text(data.username);
  const withDetail = base && text(data.dosage) ? `${base} ${data.dosage}` : base;
  if (withDetail) return text(data.code) && withDetail !== data.code ? `${withDetail} (${data.code})` : withDetail;
  // Ligne sans nom propre : on la nomme par ce à quoi elle se rattache.
  for (const key of ["patientId", "productId", "employeeId", "userId"]) {
    const id = text(data[key]);
    if (id && names.get(id)) return names.get(id)!;
  }
  return "Sans nom";
}

/** Élément principal du lot : celui visé par l'URL de suppression, sinon le premier supprimé. */
function mainRow(rows: TrashRow[]) {
  const targetId = rows[0]?.requestPath?.split("/").reverse().find((segment) => ID_IN_PATH.test(segment));
  return rows.find((row) => targetId && row.rowId === targetId) ?? rows[0];
}

function describeBatch(rows: TrashRow[], names: Map<string, string>, actorNames: Map<string, string>) {
  const main = mainRow(rows);
  const [method, path] = (main.requestPath ?? "").split(" ");
  const restoredBy = rows.find((row) => row.restoredById)?.restoredById ?? null;
  return {
    batchId: main.batchId,
    deletedAt: main.deletedAt,
    actorName: main.actorId ? actorNames.get(main.actorId) ?? "Utilisateur supprimé" : "Inconnu",
    summary: path ? describeAuditAction({ method, path, action: "DELETE", entity: "", moduleLabel: "" }) : "Suppression",
    tableLabel: TABLE_LABELS[main.tableName] ?? main.tableName,
    title: titleOf(asRecord(main.data), names),
    relatedCount: rows.length - 1,
    restoredAt: rows.find((row) => row.restoredAt)?.restoredAt ?? null,
    restoredByName: restoredBy ? actorNames.get(restoredBy) ?? null : null,
  };
}

async function namesFor(rows: TrashRow[]) {
  const ids = new Set<string>();
  for (const row of rows) collectAuditIds(row.data, ids);
  const actorIds = [...new Set(rows.flatMap((row) => [row.actorId, row.restoredById]).filter(Boolean))] as string[];
  const [names, actors] = await Promise.all([
    resolveAuditNames(ids),
    actorIds.length
      ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [],
  ]);
  return {
    names,
    actorNames: new Map(actors.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()])),
  };
}

export async function listTrash(options: { from?: Date; toExclusive?: Date; page: number; pageSize: number }) {
  const deletedAt: Prisma.DateTimeFilter = {};
  if (options.from) deletedAt.gte = options.from;
  if (options.toExclusive) deletedAt.lt = options.toExclusive;
  const where: Prisma.DeletedRecordWhereInput = Object.keys(deletedAt).length ? { deletedAt } : {};

  // Pagination par lot : on liste d'abord les lots, puis leurs lignes.
  const batches = await prisma.deletedRecord.groupBy({
    by: ["batchId"],
    where,
    _min: { deletedAt: true },
    orderBy: { _min: { deletedAt: "desc" } },
  });
  const pageBatchIds = batches
    .slice((options.page - 1) * options.pageSize, options.page * options.pageSize)
    .map((row) => row.batchId);
  const rows = pageBatchIds.length
    ? await prisma.deletedRecord.findMany({
        where: { batchId: { in: pageBatchIds } },
        orderBy: { deletedAt: "asc" },
      })
    : [];
  const { names, actorNames } = await namesFor(rows);
  const byBatch = new Map<string, TrashRow[]>();
  for (const row of rows) byBatch.set(row.batchId, [...(byBatch.get(row.batchId) ?? []), row]);

  return {
    total: batches.length,
    items: pageBatchIds
      .map((batchId) => byBatch.get(batchId))
      .filter((batch): batch is TrashRow[] => Boolean(batch?.length))
      .map((batch) => describeBatch(batch, names, actorNames)),
  };
}

export async function getTrashBatch(batchId: string) {
  const rows = await prisma.deletedRecord.findMany({ where: { batchId }, orderBy: { deletedAt: "asc" } });
  if (!rows.length) return null;
  const { names, actorNames } = await namesFor(rows);
  const main = mainRow(rows);
  const readable = (row: TrashRow): AuditReadableDetails => {
    const data = Object.fromEntries(
      Object.entries(asRecord(row.data)).filter(([key]) => !HIDDEN_COLUMNS.has(key)),
    );
    return readableAuditDetails(data, names);
  };
  return {
    ...describeBatch(rows, names, actorNames),
    requestPath: main.requestPath,
    items: [main, ...rows.filter((row) => row !== main)].map((row) => ({
      id: row.id,
      isMain: row === main,
      tableLabel: TABLE_LABELS[row.tableName] ?? row.tableName,
      title: titleOf(asRecord(row.data), names),
      readable: readable(row),
    })),
  };
}

export class TrashRestoreError extends Error {}

function restoreErrorMessage(error: unknown) {
  const code = (error as { meta?: { code?: string }; code?: string })?.meta?.code ?? "";
  const text = error instanceof Error ? error.message : String(error);
  if (code === "23505" || text.includes("23505") || /unique/i.test(text)) {
    return "Un élément identique existe déjà : il a peut-être été recréé ou déjà restauré.";
  }
  if (code === "23503" || text.includes("23503") || /foreign key/i.test(text)) {
    return "Un élément auquel il était rattaché n'existe plus (supprimé entre-temps). Restaurez d'abord cet élément.";
  }
  return "Restauration impossible : les données ne correspondent plus à l'application.";
}

/**
 * Remet toutes les lignes du lot. L'ordre de suppression ne suit pas toujours les liens
 * (lignes enfants parfois supprimées avant leur parent) : on réessaie les lignes en échec
 * tant que d'autres passent, chaque tentative isolée par un SAVEPOINT.
 */
export async function restoreTrashBatch(batchId: string, userId: string) {
  const rows = await prisma.deletedRecord.findMany({ where: { batchId }, orderBy: { deletedAt: "asc" } });
  if (!rows.length) throw new TrashRestoreError("Élément introuvable dans la corbeille.");
  if (rows.some((row) => row.restoredAt)) throw new TrashRestoreError("Cet élément a déjà été restauré.");
  for (const row of rows) {
    if (!MODEL_NAMES.has(row.tableName)) throw new TrashRestoreError("Type d'élément inconnu : restauration impossible.");
  }

  await prisma.$transaction(async (tx) => {
    let pending = rows;
    let lastError: unknown = null;
    while (pending.length) {
      const failed: typeof rows = [];
      for (const row of pending) {
        await tx.$executeRawUnsafe("SAVEPOINT trash_restore");
        try {
          await tx.$executeRawUnsafe(
            `INSERT INTO "${row.tableName}" SELECT * FROM jsonb_populate_record(NULL::"${row.tableName}", $1::jsonb)`,
            JSON.stringify(row.data),
          );
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT trash_restore");
        } catch (error) {
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT trash_restore");
          lastError = error;
          failed.push(row);
        }
      }
      if (failed.length === pending.length) throw new TrashRestoreError(restoreErrorMessage(lastError));
      pending = failed;
    }
    await tx.deletedRecord.updateMany({
      where: { batchId },
      data: { restoredAt: new Date(), restoredById: userId },
    });
  }, { timeout: 30_000 });

  return { restoredCount: rows.length };
}

export function trashRetentionCutoff(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - TRASH_RETENTION_MONTHS);
  return cutoff;
}

/** Vide la corbeille des éléments supprimés il y a plus de 2 mois. */
export async function purgeOldTrash(now = new Date()): Promise<number> {
  const cutoff = trashRetentionCutoff(now);
  const result = await runWithAppDataDeleteUnlock("script", async () =>
    await prisma.deletedRecord.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
  );
  if (result.count) {
    console.log(
      `[corbeille] purge : ${result.count} élément(s) supprimé(s) avant le ${cutoff.toLocaleDateString("fr-FR")}`,
    );
  }
  return result.count;
}
