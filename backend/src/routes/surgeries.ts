import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { InvoiceStatus, InvoiceType, Prisma, SurgeryStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { computeSurgeryShares, resolveSurgeonPercent, selectableDoctorByIdWhere } from "../lib/doctor-compensation.js";
import { syncPaidOperationSurgeonCashShare } from "../lib/doctor-share-claims.js";
import {
  buildPrescribedExamsNotesByKind,
  parsePrescribedExamCommentsByKind,
  parsePrescribedExamsByKind,
  removePrescribedExamLabelsFromNotes,
} from "../lib/lab-notes.js";
import { comptabilitePatientWhere } from "../lib/patient-billing.js";
import {
  AWAITING_PERFORMANCE_STATUSES,
  COMPLETABLE_STATUSES,
  appendSurgeryFinalComment,
  completeSurgeryCase,
  parseOperationDateInput,
  promoteDueSurgeries,
  revertSurgeryToAwaiting,
} from "../lib/surgery-scheduling.js";
import {
  buildSharePaymentUpdate,
  getUnpaidShareKinds,
  hasAnySharePaid,
  type OperationShareKind,
} from "../lib/surgery-share-payments.js";
import { requireAuth, requireAnyModule, requireModule } from "../middleware/auth.js";

const router = Router();

const surgeryInclude = {
  visit: {
    include: {
      patient: true,
      consultation: { select: { id: true, doctorComment: true, diagnosis: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      assignedClinicService: { select: { id: true, name: true } },
    },
  },
  interventionType: {
    include: {
      anesthesiologist: { select: { id: true, firstName: true, lastName: true } },
      clinicService: { select: { id: true, name: true } },
    },
  },
  surgeon: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employee: {
        select: {
          clinicService: { select: { id: true, name: true } },
          clinicServiceLinks: {
            select: { clinicService: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
  accountant: { select: { id: true, firstName: true, lastName: true } },
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      amountFcfa: true,
      paidAmountFcfa: true,
      paidAt: true,
      type: true,
      billingExamKind: true,
      createdAt: true,
      issuedBy: { select: { id: true, firstName: true, lastName: true } },
      payments: {
        select: {
          id: true,
          amountFcfa: true,
          paidAt: true,
          recordedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { paidAt: "asc" },
      },
    },
  },
} as const;

const DOCTOR_VISIBLE_STATUSES: SurgeryStatus[] = [
  SurgeryStatus.NOTIFIED,
  SurgeryStatus.QUOTED,
  ...AWAITING_PERFORMANCE_STATUSES,
  SurgeryStatus.COMPLETED,
];

function resolveMyShareKind(
  surgery: {
    surgeonId: string;
    interventionType: { anesthesiologistId: string | null; anesthesiologistPercent: number };
  },
  userId: string,
): OperationShareKind | null {
  if (surgery.surgeonId === userId) return "surgeon";
  if (
    surgery.interventionType.anesthesiologistPercent > 0 &&
    surgery.interventionType.anesthesiologistId === userId
  ) {
    return "assistant";
  }
  return null;
}

function doctorSurgeryWhere(userId: string) {
  return {
    OR: [
      { surgeonId: userId },
      {
        interventionType: {
          anesthesiologistId: userId,
          anesthesiologistPercent: { gt: 0 },
        },
      },
    ],
  };
}

router.get("/mine", requireAuth, requireModule("consultation"), async (req, res) => {
  try {
    const userId = req.user!.id;
    const scope = String(req.query.scope ?? "all");
    const now = new Date();

    await promoteDueSurgeries(now);

    let statusFilter: { status: { in: SurgeryStatus[] } } | { status: SurgeryStatus };
    if (scope === "awaiting") {
      statusFilter = { status: { in: AWAITING_PERFORMANCE_STATUSES } };
    } else if (scope === "completed") {
      statusFilter = { status: SurgeryStatus.COMPLETED };
    } else if (scope === "all") {
      statusFilter = { status: { in: DOCTOR_VISIBLE_STATUSES } };
    } else {
      return res.status(400).json({ error: "Scope invalide." });
    }

    const surgeries = await prisma.surgeryCase.findMany({
      where: {
        ...doctorSurgeryWhere(userId),
        ...statusFilter,
        visit: { patient: comptabilitePatientWhere() },
      },
      include: surgeryInclude,
      orderBy: [{ completedAt: "desc" }, { operationScheduledAt: "asc" }, { paidAt: "desc" }],
    });

    const payload = surgeries
      .map((surgery) => {
        const myShareKind = resolveMyShareKind(surgery, userId);
        if (!myShareKind) return null;
        return { ...surgery, myShareKind };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return res.json(payload);
  } catch (error) {
    console.error("GET /surgeries/mine failed:", error);
    return res.status(500).json({ error: "Impossible de charger vos opérations." });
  }
});

/** Médecin (chirurgien / assistant) : marquer son opération comme effectuée. */
router.post(
  "/mine/:id/complete",
  requireAuth,
  requireModule("consultation"),
  async (req, res) => {
  try {
    const surgeryId = String(req.params.id);
    const userId = req.user!.id;
    const note =
      typeof req.body?.notes === "string"
        ? req.body.notes.trim()
        : typeof req.body?.comment === "string"
          ? req.body.comment.trim()
          : "";

    const surgery = await prisma.surgeryCase.findUnique({
      where: { id: surgeryId },
      include: surgeryInclude,
    });

    if (!surgery) {
      return res.status(404).json({ error: "Opération introuvable." });
    }

    if (!resolveMyShareKind(surgery, userId)) {
      return res.status(403).json({
        error: "Vous n’êtes pas rattaché à cette opération.",
      });
    }

    if (!COMPLETABLE_STATUSES.includes(surgery.status)) {
      return res.status(409).json({
        error:
          surgery.status === SurgeryStatus.COMPLETED
            ? "Cette opération est déjà marquée comme effectuée."
            : "Cette opération ne peut pas être clôturée.",
      });
    }

    if (!note || note.length < 2) {
      return res.status(400).json({
        error: "Le commentaire est requis pour enregistrer le dossier.",
      });
    }

    await completeSurgeryCase(surgery.id, new Date(), note);

    const updated = await prisma.surgeryCase.findUniqueOrThrow({
      where: { id: surgery.id },
      include: surgeryInclude,
    });

    const myShareKind = resolveMyShareKind(updated, userId);
    return res.json({ ...updated, myShareKind });
  } catch (error) {
    console.error("POST /surgeries/mine/:id/complete failed:", error);
    return res.status(500).json({ error: "Impossible de clôturer l’opération." });
  }
});

/** Médecin : ajouter un commentaire final après clôture. */
router.post(
  "/mine/:id/final-comment",
  requireAuth,
  requireModule("consultation"),
  async (req, res) => {
    try {
      const surgeryId = String(req.params.id);
      const userId = req.user!.id;
      const note =
        typeof req.body?.notes === "string"
          ? req.body.notes.trim()
          : typeof req.body?.comment === "string"
            ? req.body.comment.trim()
            : "";

      if (!note) {
        return res.status(400).json({ error: "Le commentaire final est requis." });
      }

      const surgery = await prisma.surgeryCase.findUnique({
        where: { id: surgeryId },
        include: surgeryInclude,
      });

      if (!surgery) {
        return res.status(404).json({ error: "Opération introuvable." });
      }

      if (!resolveMyShareKind(surgery, userId)) {
        return res.status(403).json({
          error: "Vous n’êtes pas rattaché à cette opération.",
        });
      }

      if (surgery.status !== SurgeryStatus.COMPLETED) {
        return res.status(409).json({
          error: "Le commentaire final ne peut être ajouté que sur une opération effectuée.",
        });
      }

      await appendSurgeryFinalComment(surgery.id, note);

      const updated = await prisma.surgeryCase.findUniqueOrThrow({
        where: { id: surgery.id },
        include: surgeryInclude,
      });

      const myShareKind = resolveMyShareKind(updated, userId);
      return res.json({ ...updated, myShareKind });
    } catch (error) {
      console.error("POST /surgeries/mine/:id/final-comment failed:", error);
      return res.status(500).json({ error: "Impossible d’enregistrer le commentaire final." });
    }
  },
);

router.use(requireAuth, requireAnyModule("reception", "comptabilite", "bloc-salles"));

const shareKindSchema = z.enum(["surgeon", "assistant", "clinic"]);

router.get("/", async (req, res) => {
  try {
    const scope = String(req.query.scope ?? "awaiting");
    const now = new Date();

    await promoteDueSurgeries(now);

    if (scope === "awaiting") {
      const surgeries = await prisma.surgeryCase.findMany({
        where: {
          status: { in: AWAITING_PERFORMANCE_STATUSES },
          visit: { patient: comptabilitePatientWhere() },
        },
        include: surgeryInclude,
        orderBy: [{ operationScheduledAt: "asc" }, { paidAt: "asc" }],
      });

      return res.json(surgeries);
    }

    if (scope === "completed") {
      const surgeries = await prisma.surgeryCase.findMany({
        where: {
          visit: { patient: comptabilitePatientWhere() },
          OR: [
            { status: SurgeryStatus.COMPLETED },
            {
              status: { in: [SurgeryStatus.NOTIFIED, SurgeryStatus.QUOTED] },
              invoice: { paidAmountFcfa: { gt: 0 } },
            },
          ],
        },
        include: surgeryInclude,
        orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      });

      return res.json(surgeries);
    }

    if (scope === "all") {
      const surgeries = await prisma.surgeryCase.findMany({
        where: {
          status: { not: SurgeryStatus.CANCELLED },
          visit: { patient: comptabilitePatientWhere() },
        },
        include: surgeryInclude,
        orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      });

      return res.json(surgeries);
    }

    return res.status(400).json({ error: "Scope invalide." });
  } catch (error) {
    console.error("GET /surgeries failed:", error);
    return res.status(500).json({ error: "Impossible de charger les opérations." });
  }
});

const userRefSelect = { select: { id: true, firstName: true, lastName: true } } as const;

function personName(user?: { firstName: string; lastName: string } | null) {
  if (!user) return "";
  return `${user.firstName} ${user.lastName}`.trim();
}

type ServiceRef = { id: string; name: string } | null | undefined;

/** Service de l'opération : celui de l'acte, puis celui enregistré sur la visite. */
function operationServiceName(input: {
  assignedService?: ServiceRef;
  typeService?: ServiceRef;
  operationLabel?: string | null;
  patientService?: string | null;
}) {
  const typeName = input.typeService?.name?.trim() || "";
  const assignedName = input.assignedService?.name?.trim() || "";
  const recorded = input.patientService?.trim() || assignedName;
  const act = input.operationLabel?.trim() || "";
  if (
    recorded &&
    act &&
    typeName &&
    foldServiceName(act) === foldServiceName(typeName) &&
    foldServiceName(recorded) !== foldServiceName(typeName)
  ) {
    return recorded;
  }
  return typeName || recorded;
}

function foldServiceName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function assistantNameFromType(type: {
  anesthesiologistPercent: number;
  anesthesiologistName: string | null;
  anesthesiologist: { firstName: string; lastName: string } | null;
}) {
  if (type.anesthesiologistPercent <= 0) return null;
  const linked = personName(type.anesthesiologist);
  if (linked) return linked;
  return type.anesthesiologistName?.trim() || null;
}

/** Opérations facturées depuis la consultation sans dossier bloc opératoire. */
router.get("/other-operations", async (_req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        type: InvoiceType.LAB_EXAM,
        billingExamKind: "operation",
        surgeryCaseId: null,
        status: { not: InvoiceStatus.CANCELLED },
        patient: comptabilitePatientWhere(),
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        amountFcfa: true,
        paidAmountFcfa: true,
        paidAt: true,
        createdAt: true,
        issuedBy: userRefSelect,
        payments: {
          select: { id: true, amountFcfa: true, paidAt: true, recordedBy: userRefSelect },
          orderBy: { paidAt: "asc" },
        },
        visit: {
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            createdBy: userRefSelect,
            assignedDoctor: {
              select: { id: true, firstName: true, lastName: true },
            },
            assignedClinicService: { select: { id: true, name: true } },
            patient: { select: { code: true, firstName: true, lastName: true, service: true } },
            consultation: {
              select: {
                id: true,
                clinicalNotes: true,
                doctor: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const drafts = invoices
      .filter((invoice) => invoice.visit)
      .map(({ visit, ...invoice }) => {
        const { consultation, assignedDoctor, assignedClinicService, ...visitRest } = visit!;
        const labels = parsePrescribedExamsByKind(consultation?.clinicalNotes).operation ?? [];
        const interventionLabel = labels.filter(Boolean).join(", ") || "Opération";
        const doctorSource = consultation?.doctor ?? assignedDoctor ?? null;
        const doctor = doctorSource
          ? { id: doctorSource.id, firstName: doctorSource.firstName, lastName: doctorSource.lastName }
          : null;
        return {
          ...invoice,
          interventionLabel,
          doctor,
          assignedClinicService,
          visit: { ...visitRest, consultation: consultation ? { id: consultation.id } : null },
        };
      });

    const labels = [...new Set(drafts.map((row) => row.interventionLabel).filter(Boolean))];
    const types = labels.length
      ? await prisma.interventionType.findMany({
          where: { label: { in: labels } },
          select: {
            label: true,
            surgeonId: true,
            anesthesiologistPercent: true,
            anesthesiologistName: true,
            anesthesiologist: { select: { firstName: true, lastName: true } },
            clinicService: { select: { id: true, name: true } },
          },
        })
      : [];

    const payload = drafts.map((row) => {
      const matches = types.filter((type) => type.label === row.interventionLabel);
      const assignedId = row.assignedClinicService?.id;
      const type =
        (assignedId
          ? matches.find((item) => item.clinicService?.id === assignedId)
          : undefined) ??
        matches.find(
          (item) => item.surgeonId && item.surgeonId === row.doctor?.id,
        ) ??
        (matches.length === 1 ? matches[0] : undefined);
      const { assignedClinicService, ...rest } = row;
      return {
        ...rest,
        assistantName: type ? assistantNameFromType(type) : null,
        serviceName: operationServiceName({
          assignedService: assignedClinicService,
          typeService: type?.clinicService,
          operationLabel: row.interventionLabel,
          patientService: row.visit.patient.service,
        }),
      };
    });

    return res.json(payload);
  } catch (error) {
    console.error("GET /surgeries/other-operations failed:", error);
    return res.status(500).json({ error: "Impossible de charger les autres opérations." });
  }
});

/** Correction comptable (montant + date) : administrateur et gestionnaire uniquement. */
function requireOperationEditor(req: Request, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== "ADMIN" && role !== "GESTIONNAIRE") {
    return res.status(403).json({
      error: "Correction réservée à l'administrateur et au gestionnaire.",
      code: "OPERATION_EDIT_FORBIDDEN",
    });
  }
  next();
}

const operationBillingSchema = z.object({
  amountFcfa: z.coerce.number().int().min(0),
  operationDate: z.string().min(1),
  interventionTypeId: z.string().trim().min(1).optional(),
  clinicServiceId: z.string().trim().min(1).optional(),
  surgeonId: z.string().trim().min(1).optional(),
});

async function resolveClinicServiceId(clinicServiceId?: string | null) {
  const id = clinicServiceId?.trim();
  if (!id) return null;
  const service = await prisma.clinicService.findFirst({
    where: { id, active: true },
    select: { id: true },
  });
  return service?.id ?? null;
}

async function resolveOperationSurgeon(
  surgeonId: string | null | undefined,
  clinicServiceId: string | null,
  currentSurgeonId?: string | null,
) {
  const id = surgeonId?.trim();
  if (!id) return null;
  const doctor = await prisma.user.findFirst({
    where: selectableDoctorByIdWhere(id),
    select: {
      id: true,
      role: true,
      employee: {
        select: {
          isMedecin: true,
          doctorCompensationType: true,
          surgeryQuotaPercent: true,
          clinicServiceId: true,
          clinicServiceLinks: { select: { clinicServiceId: true } },
        },
      },
    },
  });
  if (!doctor) throw new Error("INVALID_SURGEON");
  if (clinicServiceId && doctor.id !== currentSurgeonId) {
    const employee = doctor.employee;
    const linked =
      employee?.clinicServiceId === clinicServiceId ||
      (employee?.clinicServiceLinks ?? []).some((link) => link.clinicServiceId === clinicServiceId);
    if (!linked) throw new Error("SURGEON_SERVICE");
  }
  return doctor;
}

function operationBillingError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return "Montant ou date invalide.";
  if (error instanceof Error && error.message === "INVALID_SURGEON") return "Médecin invalide.";
  if (error instanceof Error && error.message === "SURGEON_SERVICE") {
    return "Ce médecin n'est pas rattaché à ce service.";
  }
  return fallback;
}

/** Remplace le libellé d'opération dans la prescription, ou le laisse tel quel s'il n'y figure pas. */
function notesWithRenamedOperation(
  notes: string | null | undefined,
  previousLabel: string,
  nextLabel: string,
): string | null {
  const from = previousLabel.trim();
  const to = nextLabel.trim();
  if (!to || from.toLowerCase() === to.toLowerCase()) return null;
  const byKind = parsePrescribedExamsByKind(notes);
  const comments = parsePrescribedExamCommentsByKind(notes);
  const labels = [...(byKind.operation ?? [])];
  const exact = labels.findIndex((label) => label.trim().toLowerCase() === from.toLowerCase());
  if (exact >= 0) {
    labels[exact] = to;
    byKind.operation = labels;
  } else if (labels.join(", ").trim().toLowerCase() === from.toLowerCase() || labels.length === 0) {
    byKind.operation = [to];
  } else {
    return null;
  }
  return buildPrescribedExamsNotesByKind(byKind, notes, undefined, comments);
}

/**
 * Applique le jour saisi. Par défaut l'heure courante (modification = maintenant),
 * pour que la colonne Date/heure suive la modification.
 */
function replaceDatePart(
  input: string,
  previous: Date | null,
  options?: { keepPreviousTime?: boolean },
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) throw new Error("INVALID_OPERATION_DATE");
  const base =
    options?.keepPreviousTime && previous ? previous : new Date();
  const next = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds(),
  );
  if (Number.isNaN(next.getTime())) throw new Error("INVALID_OPERATION_DATE");
  return next;
}

function invoiceStatusFor(amountFcfa: number, paidAmountFcfa: number): InvoiceStatus {
  if (amountFcfa > 0 && paidAmountFcfa >= amountFcfa) return InvoiceStatus.PAID;
  if (paidAmountFcfa > 0) return InvoiceStatus.PARTIALLY_PAID;
  return InvoiceStatus.PENDING;
}

/**
 * Corrige le montant facturé en gardant l’encaissement cohérent.
 * Si la facture était soldée, le payé suit le nouveau montant (évite paid > amount).
 */
async function syncOperationInvoiceBillingAmount(
  tx: Prisma.TransactionClient,
  invoice: {
    id: string;
    amountFcfa: number;
    paidAmountFcfa: number;
    paidAt: Date | null;
    createdAt?: Date | null;
  },
  amountFcfa: number,
  recordedById: string,
  datePatch?: { paidAt?: Date; createdAt?: Date },
) {
  const wasFullyPaid =
    invoice.paidAmountFcfa > 0 && invoice.paidAmountFcfa >= invoice.amountFcfa;
  const nextPaid = wasFullyPaid
    ? amountFcfa
    : Math.min(Math.max(0, invoice.paidAmountFcfa), amountFcfa);
  const cashAt = datePatch?.paidAt ?? invoice.paidAt ?? invoice.createdAt ?? new Date();

  const listingAt = datePatch?.createdAt ?? datePatch?.paidAt ?? null;

  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      amountFcfa,
      paidAmountFcfa: nextPaid,
      status: invoiceStatusFor(amountFcfa, nextPaid),
      // Date d'enregistrement (filtres liste) : toujours alignée sur la date de saisie / modification.
      ...(listingAt ? { createdAt: listingAt } : {}),
      ...(datePatch?.paidAt
        ? { paidAt: datePatch.paidAt }
        : nextPaid > 0 && !invoice.paidAt && wasFullyPaid
          ? { paidAt: cashAt }
          : nextPaid <= 0
            ? { paidAt: null }
            : {}),
    },
  });

  if (nextPaid <= 0) {
    await tx.invoicePayment.deleteMany({ where: { invoiceId: invoice.id } });
    return nextPaid;
  }

  const payments = await tx.invoicePayment.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { paidAt: "asc" },
    select: { id: true },
  });
  if (!payments.length) {
    await tx.invoicePayment.create({
      data: {
        invoiceId: invoice.id,
        amountFcfa: nextPaid,
        recordedById,
        paidAt: cashAt,
      },
    });
    return nextPaid;
  }

  await tx.invoicePayment.update({
    where: { id: payments[0]!.id },
    data: {
      amountFcfa: nextPaid,
      ...(datePatch?.paidAt ? { paidAt: datePatch.paidAt } : {}),
    },
  });
  if (payments.length > 1) {
    await tx.invoicePayment.updateMany({
      where: { invoiceId: invoice.id, id: { not: payments[0]!.id } },
      data: { amountFcfa: 0 },
    });
  }
  return nextPaid;
}

/** Corriger le montant facturé et la date d'une opération du bloc opératoire. */
router.patch("/:id/billing", requireOperationEditor, async (req, res) => {
  try {
    const { amountFcfa, operationDate, interventionTypeId, clinicServiceId, surgeonId } =
      operationBillingSchema.parse(req.body);
    const surgeryId = String(req.params.id);

    const surgery = await prisma.surgeryCase.findUnique({
      where: { id: surgeryId },
      include: {
        interventionType: { select: { id: true, label: true, surgeonPercent: true } },
        surgeon: {
          select: {
            role: true,
            employee: {
              select: {
                isMedecin: true,
                doctorCompensationType: true,
                surgeryQuotaPercent: true,
              },
            },
          },
        },
        invoice: {
          select: {
            id: true,
            amountFcfa: true,
            paidAmountFcfa: true,
            paidAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!surgery) {
      return res.status(404).json({ error: "Opération introuvable." });
    }

    let nextDate: Date;
    try {
      nextDate = replaceDatePart(
        operationDate,
        surgery.completedAt ?? surgery.operationScheduledAt ?? surgery.invoice?.paidAt ?? null,
      );
    } catch {
      return res.status(400).json({ error: "Date d'opération invalide." });
    }

    const nextType =
      interventionTypeId && interventionTypeId !== surgery.interventionType.id
        ? await prisma.interventionType.findUnique({
            where: { id: interventionTypeId },
            select: { id: true, label: true, surgeonPercent: true, active: true, clinicServiceId: true },
          })
        : null;
    if (interventionTypeId && interventionTypeId !== surgery.interventionType.id && !nextType?.active) {
      return res.status(400).json({ error: "Cette opération n'est pas dans le catalogue." });
    }

    const requestedServiceId = nextType?.clinicServiceId || clinicServiceId?.trim() || null;
    const resolvedServiceId = requestedServiceId
      ? await resolveClinicServiceId(requestedServiceId)
      : null;
    if (requestedServiceId && !resolvedServiceId) {
      return res.status(400).json({ error: "Service introuvable." });
    }

    const nextSurgeon = await resolveOperationSurgeon(surgeonId, resolvedServiceId, surgery.surgeonId);

    const surgeonPercent = resolveSurgeonPercent(
      nextType?.surgeonPercent ?? surgery.interventionType.surgeonPercent,
      nextSurgeon ?? surgery.surgeon,
    );
    const shares = computeSurgeryShares(amountFcfa, surgeonPercent, nextSurgeon ?? surgery.surgeon);

    await prisma.$transaction(async (tx) => {
      await tx.surgeryCase.update({
        where: { id: surgery.id },
        data: {
          ...(nextType ? { interventionTypeId: nextType.id } : {}),
          ...(nextSurgeon ? { surgeonId: nextSurgeon.id, surgeonPercent } : {}),
          totalCostFcfa: amountFcfa,
          surgeonShareFcfa: shares.surgeonShareFcfa,
          clinicShareFcfa: shares.clinicShareFcfa,
          ...(surgery.completedAt
            ? { completedAt: nextDate }
            : { operationScheduledAt: nextDate }),
        },
      });

      if (nextType || nextSurgeon) {
        const consultation = await tx.consultation.findUnique({
          where: { visitId: surgery.visitId },
          select: { id: true, clinicalNotes: true },
        });
        const notes =
          nextType && consultation
            ? notesWithRenamedOperation(
                consultation.clinicalNotes,
                surgery.interventionType.label,
                nextType.label,
              )
            : null;
        if (consultation && (notes != null || nextSurgeon)) {
          await tx.consultation.update({
            where: { id: consultation.id },
            data: {
              ...(notes != null ? { clinicalNotes: notes } : {}),
              ...(nextSurgeon ? { doctorId: nextSurgeon.id } : {}),
            },
          });
        }
      }

      if (resolvedServiceId || nextSurgeon) {
        await tx.visit.update({
          where: { id: surgery.visitId },
          data: {
            ...(resolvedServiceId ? { assignedClinicServiceId: resolvedServiceId } : {}),
            ...(nextSurgeon ? { assignedDoctorId: nextSurgeon.id } : {}),
          },
        });
      }

      if (surgery.invoice) {
        // createdAt = date colonne / filtres (modification) ; paidAt reste la date d'encaissement.
        await syncOperationInvoiceBillingAmount(
          tx,
          surgery.invoice,
          amountFcfa,
          req.user!.id,
          { createdAt: nextDate },
        );
        await syncPaidOperationSurgeonCashShare(tx, surgery.invoice.id, req.user!.id);
      }
    });

    const updated = await prisma.surgeryCase.findUniqueOrThrow({
      where: { id: surgery.id },
      include: surgeryInclude,
    });

    return res.json(updated);
  } catch (error) {
    const message = operationBillingError(error, "");
    if (message) return res.status(400).json({ error: message });
    console.error("PATCH /surgeries/:id/billing failed:", error);
    return res.status(500).json({ error: "Impossible de modifier l'opération." });
  }
});

/** Corriger le montant facturé et la date d'une opération hors bloc opératoire. */
router.patch("/other-operations/:id/billing", requireOperationEditor, async (req, res) => {
  try {
    const { amountFcfa, operationDate, interventionTypeId, clinicServiceId, surgeonId } =
      operationBillingSchema.parse(req.body);
    const invoiceId = String(req.params.id);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        type: InvoiceType.LAB_EXAM,
        billingExamKind: "operation",
        surgeryCaseId: null,
      },
      select: {
        id: true,
        amountFcfa: true,
        paidAmountFcfa: true,
        paidAt: true,
        createdAt: true,
        visitId: true,
        visit: {
          select: {
            assignedDoctorId: true,
            consultation: { select: { id: true, clinicalNotes: true, doctorId: true } },
          },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "Opération introuvable." });
    }

    let nextDate: Date;
    try {
      nextDate = replaceDatePart(operationDate, invoice.paidAt ?? invoice.createdAt);
    } catch {
      return res.status(400).json({ error: "Date d'opération invalide." });
    }

    const nextType = interventionTypeId
      ? await prisma.interventionType.findUnique({
          where: { id: interventionTypeId },
          select: { id: true, label: true, active: true, clinicServiceId: true },
        })
      : null;
    if (interventionTypeId && !nextType?.active) {
      return res.status(400).json({ error: "Cette opération n'est pas dans le catalogue." });
    }

    const requestedServiceId = nextType?.clinicServiceId || clinicServiceId?.trim() || null;
    const resolvedServiceId = requestedServiceId
      ? await resolveClinicServiceId(requestedServiceId)
      : null;
    if (requestedServiceId && !resolvedServiceId) {
      return res.status(400).json({ error: "Service introuvable." });
    }

    const consultation = invoice.visit?.consultation ?? null;
    const nextSurgeon = await resolveOperationSurgeon(
      surgeonId,
      resolvedServiceId,
      consultation?.doctorId ?? invoice.visit?.assignedDoctorId ?? null,
    );
    const currentLabel = consultation
      ? (parsePrescribedExamsByKind(consultation.clinicalNotes).operation ?? [])
          .filter(Boolean)
          .join(", ")
      : "";
    const notes =
      nextType && consultation
        ? notesWithRenamedOperation(consultation.clinicalNotes, currentLabel, nextType.label)
        : null;

    await prisma.$transaction(async (tx) => {
      // createdAt facture = date d'enregistrement affichée ; visite.updatedAt = jour réel de modification.
      await syncOperationInvoiceBillingAmount(
        tx,
        invoice,
        amountFcfa,
        req.user!.id,
        { createdAt: nextDate },
      );
      if (consultation && (notes != null || nextSurgeon)) {
        await tx.consultation.update({
          where: { id: consultation.id },
          data: {
            ...(notes != null ? { clinicalNotes: notes } : {}),
            ...(nextSurgeon ? { doctorId: nextSurgeon.id } : {}),
          },
        });
      }
      if (invoice.visitId) {
        if (resolvedServiceId || nextSurgeon) {
          await tx.visit.update({
            where: { id: invoice.visitId },
            data: {
              ...(resolvedServiceId ? { assignedClinicServiceId: resolvedServiceId } : {}),
              ...(nextSurgeon ? { assignedDoctorId: nextSurgeon.id } : {}),
            },
          });
        }
        // Horodatage réel de modification (libellé « modifié JJ/MM/AAAA » = aujourd’hui).
        await tx.$executeRaw`UPDATE "Visit" SET "updatedAt" = NOW() WHERE id = ${invoice.visitId}`;
      }
    });

    return res.json({ ok: true });
  } catch (error) {
    const message = operationBillingError(error, "");
    if (message) return res.status(400).json({ error: message });
    console.error("PATCH /surgeries/other-operations/:id/billing failed:", error);
    return res.status(500).json({ error: "Impossible de modifier l'opération." });
  }
});

const DELETABLE_SURGERY_STATUSES: SurgeryStatus[] = [
  SurgeryStatus.NOTIFIED,
  SurgeryStatus.QUOTED,
  SurgeryStatus.AUTHORIZED,
];

async function removeOperationFromPrescription(
  tx: Prisma.TransactionClient,
  visitId: string,
) {
  const consultation = await tx.consultation.findUnique({
    where: { visitId },
    select: { id: true, clinicalNotes: true },
  });
  if (!consultation) return;
  const labels = parsePrescribedExamsByKind(consultation.clinicalNotes).operation ?? [];
  if (!labels.length) return;
  await tx.consultation.update({
    where: { id: consultation.id },
    data: {
      clinicalNotes: removePrescribedExamLabelsFromNotes(
        consultation.clinicalNotes,
        labels.map((examLabel) => ({ examKind: "operation" as const, examLabel })),
      ),
    },
  });
}

/** Réception : supprimer une opération du bloc pas encore encaissée. */
router.delete("/:id", async (req, res) => {
  try {
    const surgery = await prisma.surgeryCase.findUnique({
      where: { id: String(req.params.id) },
      include: { invoice: { select: { id: true, paidAmountFcfa: true } } },
    });
    if (!surgery || surgery.status === SurgeryStatus.CANCELLED) {
      return res.status(404).json({ error: "Opération introuvable." });
    }
    if ((surgery.invoice?.paidAmountFcfa ?? 0) > 0 || !DELETABLE_SURGERY_STATUSES.includes(surgery.status)) {
      return res.status(409).json({
        error: "Impossible de supprimer : un paiement a déjà été encaissé pour cette opération.",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.surgeryCase.update({
        where: { id: surgery.id },
        data: { status: SurgeryStatus.CANCELLED },
      });
      if (surgery.invoice) {
        await tx.invoice.update({
          where: { id: surgery.invoice.id },
          data: { status: InvoiceStatus.CANCELLED },
        });
      }
      await removeOperationFromPrescription(tx, surgery.visitId);
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /surgeries/:id failed:", error);
    return res.status(500).json({ error: "Impossible de supprimer l'opération." });
  }
});

/** Réception : supprimer une autre chirurgie (facture opération) pas encore encaissée. */
router.delete("/other-operations/:invoiceId", async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: String(req.params.invoiceId) },
      select: {
        id: true,
        type: true,
        billingExamKind: true,
        surgeryCaseId: true,
        status: true,
        paidAmountFcfa: true,
        visitId: true,
      },
    });
    if (
      !invoice ||
      invoice.type !== InvoiceType.LAB_EXAM ||
      invoice.billingExamKind !== "operation" ||
      invoice.surgeryCaseId ||
      invoice.status === InvoiceStatus.CANCELLED
    ) {
      return res.status(404).json({ error: "Opération introuvable." });
    }
    if (invoice.paidAmountFcfa > 0 || invoice.status === InvoiceStatus.PAID) {
      return res.status(409).json({
        error: "Impossible de supprimer : un paiement a déjà été encaissé pour cette opération.",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.CANCELLED },
      });
      if (invoice.visitId) await removeOperationFromPrescription(tx, invoice.visitId);
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("DELETE /surgeries/other-operations/:invoiceId failed:", error);
    return res.status(500).json({ error: "Impossible de supprimer l'opération." });
  }
});

const scheduleSchema = z.object({
  operationDate: z.string().min(1),
});

router.post("/:id/schedule", async (req, res) => {
  const { operationDate } = scheduleSchema.parse(req.body);
  const surgeryId = String(req.params.id);

  let scheduledAt: Date;
  try {
    scheduledAt = parseOperationDateInput(operationDate);
  } catch {
    return res.status(400).json({ error: "Date d'opération invalide." });
  }

  const surgery = await prisma.surgeryCase.findUnique({
    where: { id: surgeryId },
    include: surgeryInclude,
  });

  if (!surgery) {
    return res.status(404).json({ error: "Opération introuvable." });
  }

  if (!AWAITING_PERFORMANCE_STATUSES.includes(surgery.status)) {
    return res.status(409).json({
      error: "Seules les opérations payées peuvent être planifiées.",
    });
  }

  await prisma.surgeryCase.update({
    where: { id: surgery.id },
    data: { operationScheduledAt: scheduledAt },
  });

  await promoteDueSurgeries(new Date());

  const updated = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgery.id },
    include: surgeryInclude,
  });

  return res.json(updated);
});

router.post("/:id/complete", async (req, res) => {
  const surgeryId = String(req.params.id);
  const surgery = await prisma.surgeryCase.findUnique({
    where: { id: surgeryId },
    include: surgeryInclude,
  });

  if (!surgery) {
    return res.status(404).json({ error: "Opération introuvable." });
  }

  if (!COMPLETABLE_STATUSES.includes(surgery.status)) {
    return res.status(409).json({
      error:
        surgery.status === SurgeryStatus.COMPLETED
          ? "Cette opération est déjà marquée comme effectuée."
          : "Cette opération ne peut pas être clôturée.",
    });
  }

  await completeSurgeryCase(surgery.id);

  const updated = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgery.id },
    include: surgeryInclude,
  });

  return res.json(updated);
});

const revertSchema = z.object({
  operationDate: z.string().optional(),
});

const paySharesSchema = z.object({
  shares: z.array(shareKindSchema).min(1).max(3),
});

const paySharesBatchSchema = z.object({
  surgeryIds: z.array(z.string().min(1)).min(1).max(500),
});

function mapSharePaymentError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "ASSISTANT_SHARE_NOT_APPLICABLE") {
      return "La part assistant ne s'applique pas à cette opération.";
    }
    if (error.message === "SHARE_ALREADY_PAID") {
      return "Une ou plusieurs parts sont déjà réglées.";
    }
  }
  return null;
}

router.post("/pay-shares-batch", async (req, res) => {
  try {
    const { surgeryIds } = paySharesBatchSchema.parse(req.body);
    const userId = req.user!.id;
    const now = new Date();

    const surgeries = await prisma.surgeryCase.findMany({
      where: {
        id: { in: surgeryIds },
        status: SurgeryStatus.COMPLETED,
      },
      include: { interventionType: true },
    });

    let count = 0;

    for (const surgery of surgeries) {
      const unpaidShares = getUnpaidShareKinds(surgery);
      if (!unpaidShares.length) continue;

      try {
        const data = buildSharePaymentUpdate(surgery, unpaidShares, userId, now);
        await prisma.surgeryCase.update({
          where: { id: surgery.id },
          data,
        });
        count += unpaidShares.length;
      } catch (error) {
        const message = mapSharePaymentError(error);
        if (message) {
          return res.status(409).json({ error: message });
        }
        throw error;
      }
    }

    return res.json({ count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Liste d'opérations invalide." });
    }
    console.error("POST /surgeries/pay-shares-batch failed:", error);
    return res.status(500).json({ error: "Impossible d'enregistrer les paiements." });
  }
});

router.post("/:id/pay-shares", async (req, res) => {
  const surgeryId = String(req.params.id);

  try {
    const { shares } = paySharesSchema.parse(req.body);

    const surgery = await prisma.surgeryCase.findUnique({
      where: { id: surgeryId },
      include: surgeryInclude,
    });

    if (!surgery) {
      return res.status(404).json({ error: "Opération introuvable." });
    }

    if (surgery.status !== SurgeryStatus.COMPLETED) {
      return res.status(409).json({
        error: "Seules les opérations effectuées peuvent être réglées.",
      });
    }

    const data = buildSharePaymentUpdate(surgery, shares as OperationShareKind[], req.user!.id);

    const updated = await prisma.surgeryCase.update({
      where: { id: surgery.id },
      data,
      include: surgeryInclude,
    });

    return res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Parts à régler invalides." });
    }
    const message = mapSharePaymentError(error);
    if (message) {
      return res.status(409).json({ error: message });
    }
    console.error("POST /surgeries/:id/pay-shares failed:", error);
    return res.status(500).json({ error: "Impossible d'enregistrer le paiement." });
  }
});

router.post("/:id/revert", async (req, res) => {
  const surgeryId = String(req.params.id);
  const body = revertSchema.parse(req.body ?? {});

  let scheduledAt: Date | null = null;
  if (body.operationDate) {
    try {
      scheduledAt = parseOperationDateInput(body.operationDate);
    } catch {
      return res.status(400).json({ error: "Date de report invalide." });
    }
  }

  const surgery = await prisma.surgeryCase.findUnique({
    where: { id: surgeryId },
    include: surgeryInclude,
  });

  if (!surgery) {
    return res.status(404).json({ error: "Opération introuvable." });
  }

  if (surgery.status !== SurgeryStatus.COMPLETED) {
    return res.status(409).json({
      error: "Seules les opérations effectuées peuvent être renvoyées en attente.",
    });
  }

  if (hasAnySharePaid(surgery)) {
    return res.status(409).json({
      error: "Impossible de renvoyer en attente : un règlement a déjà été enregistré.",
    });
  }

  try {
    await revertSurgeryToAwaiting(surgery.id, scheduledAt);
  } catch (error) {
    console.error("POST /surgeries/:id/revert failed:", error);
    if (error instanceof Error && error.message === "SURGERY_NOT_REVERTIBLE") {
      return res.status(409).json({
        error: "Seules les opérations effectuées peuvent être renvoyées en attente.",
      });
    }
    return res.status(409).json({
      error:
        "Impossible de renvoyer cette opération en attente. Redémarrez le serveur backend si le problème persiste.",
    });
  }

  const updated = await prisma.surgeryCase.findUniqueOrThrow({
    where: { id: surgery.id },
    include: surgeryInclude,
  });

  return res.json(updated);
});

export default router;
