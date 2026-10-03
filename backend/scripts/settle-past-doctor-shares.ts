/**
 * Règle en espèces toutes les parts médecins (consultations et opérations)
 * antérieures à aujourd’hui (minuit, heure locale). La journée en cours reste due.
 *
 * Les opérations encore ouvertes ne sont réglées que si le dernier encaissement
 * est antérieur à aujourd’hui. La part clinique n’est pas touchée.
 *
 * Usage :
 *   npx tsx scripts/settle-past-doctor-shares.ts
 *   npx tsx scripts/settle-past-doctor-shares.ts --confirm
 */
import {
  DoctorShareClaimStatus,
  DoctorShareKind,
  SharePaymentMethod,
  UserRole,
} from "@prisma/client";
import { prisma } from "../src/lib/db.js";
import { buildDoctorReceivable } from "../src/lib/doctor-share-claims.js";

const confirmed = process.argv.includes("--confirm");

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type WorkItem = {
  doctorUserId: string;
  doctorName: string;
  employeeId: string;
  kind: DoctorShareKind;
  amountFcfa: number;
  businessDate: string;
  surgeryCaseId?: string;
  invoiceId?: string;
  label: string;
};

async function main() {
  const todayStart = startOfToday();
  const todayKey = localDateKey(todayStart);

  const actor = await prisma.user.findFirst({
    where: { active: true, role: { in: [UserRole.ADMIN, UserRole.GESTIONNAIRE] } },
    orderBy: { role: "asc" },
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  if (!actor) {
    throw new Error("Aucun administrateur ou gestionnaire actif pour signer le règlement.");
  }

  const doctors = await prisma.user.findMany({
    where: {
      OR: [{ role: UserRole.MEDECIN }, { employee: { is: { isMedecin: true } } }],
    },
    select: { id: true, firstName: true, lastName: true, employeeId: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const period = {
    from: new Date(2000, 0, 1),
    to: todayStart,
    label: "month" as const,
  };

  const items: WorkItem[] = [];
  for (const doctor of doctors) {
    if (!doctor.employeeId) continue;
    const receivable = await buildDoctorReceivable(doctor.id, period);
    for (const item of receivable.items) {
      if (item.businessDate >= todayKey) continue;
      items.push({
        doctorUserId: doctor.id,
        doctorName: `${doctor.lastName} ${doctor.firstName}`.trim(),
        employeeId: doctor.employeeId,
        kind: item.kind,
        amountFcfa: item.amountFcfa,
        businessDate: item.businessDate,
        surgeryCaseId: item.surgeryCaseId,
        invoiceId: item.invoiceId,
        label: item.label,
      });
    }
  }

  const pending = await prisma.doctorShareClaim.findMany({
    where: {
      status: DoctorShareClaimStatus.PENDING_PAYROLL,
      businessDate: { lt: todayStart },
    },
    select: {
      id: true,
      doctorUserId: true,
      employeeId: true,
      kind: true,
      amountFcfa: true,
      surgeryCaseId: true,
      businessDate: true,
      doctorUser: { select: { firstName: true, lastName: true } },
    },
  });

  const consultItems = items.filter((row) => row.kind === DoctorShareKind.CONSULTATION);
  const surgeryItems = items.filter((row) => row.kind !== DoctorShareKind.CONSULTATION);
  const sum = (rows: Array<{ amountFcfa: number }>) =>
    rows.reduce((total, row) => total + row.amountFcfa, 0);

  console.log(`Journée conservée (non réglée) : ${todayKey}`);
  console.log(`Signataire : ${actor.lastName} ${actor.firstName} (${actor.role})`);
  console.log("");
  console.log(
    `Consultations à régler : ${consultItems.length}  (${sum(consultItems).toLocaleString("fr-FR")} F)`,
  );
  console.log(
    `Opérations à régler    : ${surgeryItems.length}  (${sum(surgeryItems).toLocaleString("fr-FR")} F)`,
  );
  console.log(
    `Demandes paie passées  : ${pending.length}  (${sum(pending).toLocaleString("fr-FR")} F)`,
  );

  const byDoctor = new Map<string, { consult: number; surgery: number; payroll: number }>();
  for (const row of items) {
    const bucket = byDoctor.get(row.doctorName) ?? { consult: 0, surgery: 0, payroll: 0 };
    if (row.kind === DoctorShareKind.CONSULTATION) bucket.consult += row.amountFcfa;
    else bucket.surgery += row.amountFcfa;
    byDoctor.set(row.doctorName, bucket);
  }
  for (const row of pending) {
    const name = `${row.doctorUser.lastName} ${row.doctorUser.firstName}`.trim();
    const bucket = byDoctor.get(name) ?? { consult: 0, surgery: 0, payroll: 0 };
    bucket.payroll += row.amountFcfa;
    byDoctor.set(name, bucket);
  }
  if (byDoctor.size) {
    console.log("");
    for (const [name, amounts] of [...byDoctor.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"))) {
      console.log(
        `  ${name} — consult. ${amounts.consult.toLocaleString("fr-FR")} F, opér. ${amounts.surgery.toLocaleString("fr-FR")} F, paie en attente ${amounts.payroll.toLocaleString("fr-FR")} F`,
      );
    }
  }

  if (!confirmed) {
    console.log("");
    console.log("Aperçu seulement. Relancer avec --confirm pour enregistrer le règlement.");
    return;
  }

  const now = new Date();
  let settledClaims = 0;
  let settledSurgeries = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const claim of pending) {
        await tx.doctorShareClaim.update({
          where: { id: claim.id },
          data: {
            status: DoctorShareClaimStatus.SETTLED_CASH,
            settledAt: now,
            settledById: actor.id,
          },
        });
        settledClaims += 1;
        if (claim.surgeryCaseId) {
          settledSurgeries += await markSurgerySharePaid(tx, claim.surgeryCaseId, claim.kind, actor.id, now);
        }
      }

      for (const item of items) {
        const existing = item.invoiceId
          ? await tx.doctorShareClaim.findFirst({
              where: { invoiceId: item.invoiceId, kind: item.kind },
            })
          : item.surgeryCaseId
            ? await tx.doctorShareClaim.findFirst({
                where: { surgeryCaseId: item.surgeryCaseId, kind: item.kind },
              })
            : null;

        if (existing && (existing.status === DoctorShareClaimStatus.SETTLED_CASH || existing.status === DoctorShareClaimStatus.SETTLED_PAYROLL)) {
          if (item.surgeryCaseId) {
            settledSurgeries += await markSurgerySharePaid(tx, item.surgeryCaseId, item.kind, actor.id, now);
          }
          continue;
        }

        const [y, m, d] = item.businessDate.split("-").map(Number);
        const businessDate = new Date(y, (m ?? 1) - 1, d ?? 1);

        if (existing) {
          await tx.doctorShareClaim.update({
            where: { id: existing.id },
            data: {
              status: DoctorShareClaimStatus.SETTLED_CASH,
              amountFcfa: item.amountFcfa,
              businessDate,
              settledAt: now,
              settledById: actor.id,
              rejectionReason: null,
            },
          });
        } else {
          await tx.doctorShareClaim.create({
            data: {
              employeeId: item.employeeId,
              doctorUserId: item.doctorUserId,
              kind: item.kind,
              amountFcfa: item.amountFcfa,
              businessDate,
              surgeryCaseId: item.surgeryCaseId ?? null,
              invoiceId: item.invoiceId ?? null,
              status: DoctorShareClaimStatus.SETTLED_CASH,
              requestedById: actor.id,
              settledById: actor.id,
              settledAt: now,
              comment: "Règlement groupé des parts antérieures à aujourd'hui",
            },
          });
        }
        settledClaims += 1;
        if (item.surgeryCaseId) {
          settledSurgeries += await markSurgerySharePaid(tx, item.surgeryCaseId, item.kind, actor.id, now);
        }
      }
    },
    { timeout: 180_000 },
  );

  console.log("");
  console.log(`Règlement enregistré : ${settledClaims} créance(s), ${settledSurgeries} part(s) d'opération.`);
}

async function markSurgerySharePaid(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  surgeryCaseId: string,
  kind: DoctorShareKind,
  actorId: string,
  now: Date,
) {
  if (kind === DoctorShareKind.OPERATION_SURGEON) {
    const result = await tx.surgeryCase.updateMany({
      where: { id: surgeryCaseId, surgeonPaidAt: null },
      data: {
        surgeonPaidAt: now,
        surgeonPaidById: actorId,
        surgeonPaidMethod: SharePaymentMethod.CASH,
      },
    });
    return result.count;
  }
  if (kind === DoctorShareKind.OPERATION_ASSISTANT) {
    const result = await tx.surgeryCase.updateMany({
      where: { id: surgeryCaseId, assistantPaidAt: null },
      data: {
        assistantPaidAt: now,
        assistantPaidById: actorId,
        assistantPaidMethod: SharePaymentMethod.CASH,
      },
    });
    return result.count;
  }
  return 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
