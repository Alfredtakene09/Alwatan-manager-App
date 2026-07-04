import { Router } from "express";
import { z } from "zod";
import {
  HospitalizationStatus,
  InvoiceStatus,
  InvoiceType,
  VisitStatus,
} from "@prisma/client";
import { prisma } from "../lib/db.js";
import { comptabilitePatientWhere } from "../lib/patient-billing.js";
import {
  ensureHospitalizationFromReferral,
  hospitalisationPrescriptionLabel,
  isHospitalizationPendingAdmission,
  syncHospitalizationReferralsFromPaymentQueue,
  syncMissingHospitalizationReferrals,
} from "../lib/hospitalization-referral.js";
import { generateInvoiceNumber } from "../lib/patient-code.js";
import {
  assertRoomAvailableForAdmission,
  computeRoomTypeAvailability,
  enrichRoomsWithStatus,
} from "../lib/hospitalization-rooms.js";
import { findDuplicateRoomByName } from "../lib/duplicate-detection.js";
import { duplicateErrorResponse } from "../lib/duplicate-error.js";
import { requireAuth, requireModule, requireManageAccess } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireModule("hospitalisation"));

const roomSchema = z.object({
  name: z.string().min(2),
  type: z.enum(["VIP", "SIMPLE"]),
  description: z.string().optional(),
  dailyRateFcfa: z.number().int().positive(),
  active: z.boolean().optional(),
});

const hospitalizationSchema = z.object({
  hospitalizationId: z.string(),
  roomId: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reductionFcfa: z.coerce.number().int().min(0).default(0),
  service: z.string().optional(),
  attendingDoctor: z.string().optional(),
  doctorInstructions: z.string().optional(),
});

const updateAdmissionSchema = z.object({
  hospitalizationId: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reductionFcfa: z.coerce.number().int().min(0).default(0),
  service: z.string().optional(),
  attendingDoctor: z.string().optional(),
  doctorInstructions: z.string().optional(),
});

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function computeStayNights(startIso: string, endIso: string) {
  const startDate = parseIsoDate(startIso);
  const endDate = parseIsoDate(endIso);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    throw new Error("INVALID_DATES");
  }
  const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays);
}

const dischargeSchema = z.object({
  hospitalizationId: z.string(),
  endDate: z.string(),
});

router.get("/", async (req, res) => {
  try {
    const patientWhere = comptabilitePatientWhere();
    await syncMissingHospitalizationReferrals(prisma, patientWhere);
    await syncHospitalizationReferralsFromPaymentQueue(prisma, patientWhere);

    const visitId =
      typeof req.query.visitId === "string" && req.query.visitId.trim()
        ? req.query.visitId.trim()
        : null;
    if (visitId) {
      const consultation = await prisma.consultation.findUnique({
        where: { visitId },
        select: { visitId: true, clinicalNotes: true, needsHospitalization: true },
      });
      if (consultation) {
        const label = hospitalisationPrescriptionLabel(consultation.clinicalNotes);
        await ensureHospitalizationFromReferral(prisma, visitId, label);
      }
    }

    const [rooms, hospitalizations] = await Promise.all([
      prisma.room.findMany({
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      prisma.hospitalization.findMany({
        where: {
          status: { not: HospitalizationStatus.CANCELLED },
          visit: { patient: comptabilitePatientWhere() },
        },
        include: {
          visit: {
            include: {
              patient: true,
              assignedDoctor: true,
              consultation: { include: { doctor: true } },
            },
          },
          room: true,
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
    ]);

    const roomsWithStatus = enrichRoomsWithStatus(rooms, hospitalizations);
    const freeRooms = roomsWithStatus.filter((room) => room.status === "LIBRE").length;
    const occupiedRooms = roomsWithStatus.filter((room) => room.status === "OCCUPE").length;
    const roomAvailability = computeRoomTypeAvailability(rooms, hospitalizations);

    return res.json({
      rooms: roomsWithStatus,
      hospitalizations,
      roomAvailability,
      stats: {
        roomCount: rooms.length,
        freeRooms,
        occupiedRooms,
        pendingHospitalizations: hospitalizations.filter((h) =>
          isHospitalizationPendingAdmission(h),
        ).length,
      },
    });
  } catch (error) {
    console.error("[hospitalisation] GET /", error);
    return res.status(500).json({ error: "Impossible de charger les salles et hospitalisations." });
  }
});

router.post("/rooms", requireManageAccess, async (req, res) => {
  try {
    const body = roomSchema.parse(req.body);
    const duplicate = await findDuplicateRoomByName(body.name);
    if (duplicate) {
      return res.status(409).json(
        duplicateErrorResponse(
          "room",
          "Une salle avec ce nom existe déjà.",
          { name: duplicate.name, type: duplicate.type, dailyRateFcfa: duplicate.dailyRateFcfa },
        ),
      );
    }
    const room = await prisma.room.create({ data: body });
    return res.status(201).json(room);
  } catch {
    return res.status(400).json({ error: "Données invalides" });
  }
});

router.put("/rooms/:id", requireManageAccess, async (req, res) => {
  try {
    const body = roomSchema.partial().parse(req.body);
    const room = await prisma.room.update({
      where: { id: String(req.params.id) },
      data: body,
    });
    return res.json(room);
  } catch {
    return res.status(400).json({ error: "Mise à jour impossible" });
  }
});

router.delete("/rooms/:id", requireManageAccess, async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: String(req.params.id) },
    });
    if (!room) return res.status(404).json({ error: "Salle introuvable" });

    const linkedHospitalizations = await prisma.hospitalization.count({
      where: {
        roomId: room.id,
        status: {
          in: [HospitalizationStatus.REQUESTED, HospitalizationStatus.RESERVED, HospitalizationStatus.ACTIVE],
        },
      },
    });
    if (linkedHospitalizations > 0) {
      return res.status(409).json({ error: "Des hospitalisations sont encore liées à cette salle." });
    }

    await prisma.room.delete({ where: { id: room.id } });
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ error: "Suppression impossible" });
  }
});

router.post("/actions", async (req, res) => {
  const user = req.user!;
  const action = req.body.action as string;

  try {
    if (action === "ensure_referral") {
      const visitId = z.string().min(1).parse(req.body.visitId);
      const consultation = await prisma.consultation.findUnique({
        where: { visitId },
        select: { visitId: true, clinicalNotes: true, needsHospitalization: true },
      });
      if (!consultation) {
        return res.status(404).json({ error: "Consultation introuvable" });
      }
      const label = hospitalisationPrescriptionLabel(consultation.clinicalNotes);
      const hospitalization = await ensureHospitalizationFromReferral(prisma, visitId, label);
      return res.json({ hospitalization });
    }

    if (action === "reserve_room" || action === "reserve_bed") {
      const data = hospitalizationSchema.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        const room = await assertRoomAvailableForAdmission(tx, data.roomId, data.hospitalizationId);

        const startDate = parseIsoDate(data.startDate);
        const endDate = parseIsoDate(data.endDate);
        const nights = computeStayNights(data.startDate, data.endDate);
        const grossFcfa = nights * room.dailyRateFcfa;
        const reductionFcfa = Math.min(Math.max(0, data.reductionFcfa), grossFcfa);
        const totalDueFcfa = Math.max(0, grossFcfa - reductionFcfa);

        const hospitalization = await tx.hospitalization.update({
          where: { id: data.hospitalizationId },
          data: {
            roomId: data.roomId,
            accountantId: user.id,
            roomType: room.type,
            dailyRateFcfa: room.dailyRateFcfa,
            depositFcfa: 0,
            reductionFcfa,
            nightsCount: nights,
            totalDueFcfa,
            status: HospitalizationStatus.ACTIVE,
            startDate,
            endDate,
            service: data.service?.trim() || null,
            attendingDoctor: data.attendingDoctor?.trim() || null,
            doctorInstructions: data.doctorInstructions?.trim() || null,
            paidAt: totalDueFcfa > 0 ? new Date() : null,
          },
          include: { visit: true, room: true },
        });
        const invoice =
          totalDueFcfa > 0
            ? await tx.invoice.create({
                data: {
                  invoiceNumber: await generateInvoiceNumber(),
                  patientId: hospitalization.visit.patientId,
                  visitId: hospitalization.visitId,
                  hospitalizationId: hospitalization.id,
                  type: InvoiceType.HOSPITALIZATION_FINAL,
                  amountFcfa: totalDueFcfa,
                  status: InvoiceStatus.PAID,
                  issuedById: user.id,
                  paidAt: new Date(),
                },
              })
            : null;
        await tx.visit.update({ where: { id: hospitalization.visitId }, data: { status: VisitStatus.IN_TREATMENT } });
        return { hospitalization, invoice, nights, totalDueFcfa, reductionFcfa };
      });
      return res.json(result);
    }

    if (action === "update_admission") {
      const data = updateAdmissionSchema.parse(req.body);
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.hospitalization.findUniqueOrThrow({
          where: { id: data.hospitalizationId },
          include: { room: true, visit: true },
        });
        if (!existing.roomId || !existing.room) throw new Error("INVALID_HOSPITALIZATION");

        const startDate = parseIsoDate(data.startDate);
        const endDate = parseIsoDate(data.endDate);
        const nights = computeStayNights(data.startDate, data.endDate);
        const grossFcfa = nights * existing.dailyRateFcfa;
        const reductionFcfa = Math.min(Math.max(0, data.reductionFcfa), grossFcfa);
        const totalDueFcfa = Math.max(0, grossFcfa - reductionFcfa);

        const hospitalization = await tx.hospitalization.update({
          where: { id: data.hospitalizationId },
          data: {
            startDate,
            endDate,
            reductionFcfa,
            nightsCount: nights,
            totalDueFcfa,
            service: data.service?.trim() || null,
            attendingDoctor: data.attendingDoctor?.trim() || null,
            doctorInstructions: data.doctorInstructions?.trim() || null,
          },
          include: { visit: true, room: true },
        });

        return { hospitalization, nights, totalDueFcfa, reductionFcfa };
      });
      return res.json(result);
    }

    if (action === "discharge") {
      const data = dischargeSchema.parse(req.body);
      const endDate = new Date(data.endDate);
      const result = await prisma.$transaction(async (tx) => {
        const hospitalization = await tx.hospitalization.findUniqueOrThrow({
          where: { id: data.hospitalizationId },
          include: { visit: true, room: true },
        });
        if (!hospitalization.startDate || !hospitalization.roomId) throw new Error("INVALID_HOSPITALIZATION");

        const nights = Math.max(
          1,
          Math.ceil((endDate.getTime() - hospitalization.startDate.getTime()) / (1000 * 60 * 60 * 24)),
        );
        const grossFcfa = nights * hospitalization.dailyRateFcfa;
        const reductionFcfa = hospitalization.reductionFcfa ?? 0;
        const totalDue = Math.max(0, grossFcfa - reductionFcfa);
        const alreadyPaid = hospitalization.totalDueFcfa ?? 0;
        const balance = Math.max(0, totalDue - alreadyPaid);

        const updated = await tx.hospitalization.update({
          where: { id: hospitalization.id },
          data: {
            endDate,
            nightsCount: nights,
            totalDueFcfa: totalDue,
            reductionFcfa,
            status: HospitalizationStatus.DISCHARGED,
            dischargedAt: new Date(),
            roomId: null,
          },
        });

        let invoice = null;
        if (balance > 0) {
          invoice = await tx.invoice.create({
            data: {
              invoiceNumber: await generateInvoiceNumber(),
              patientId: hospitalization.visit.patientId,
              visitId: hospitalization.visitId,
              hospitalizationId: hospitalization.id,
              type: InvoiceType.HOSPITALIZATION_FINAL,
              amountFcfa: balance,
              status: InvoiceStatus.PAID,
              issuedById: user.id,
              paidAt: new Date(),
            },
          });
        }
        await tx.visit.update({ where: { id: hospitalization.visitId }, data: { status: VisitStatus.COMPLETED } });
        return { hospitalization: updated, invoice, nights, totalDue, balance };
      });
      return res.json(result);
    }

    return res.status(400).json({ error: "Action inconnue" });
  } catch (error) {
    console.error("[hospitalisation/actions]", action, error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Données invalides", details: error.issues });
    }
    if (error instanceof Error && error.message === "ROOM_UNAVAILABLE") {
      return res.status(409).json({ error: "Salle indisponible" });
    }
    if (error instanceof Error && error.message === "VIP_ROOM_OCCUPIED") {
      return res.status(409).json({
        error: "La chambre VIP est déjà occupée. Choisissez une autre salle ou attendez la sortie du patient.",
      });
    }
    if (error instanceof Error && error.message === "INVALID_DATES") {
      return res.status(400).json({ error: "Dates de séjour invalides" });
    }
    const detail = error instanceof Error ? error.message : "Erreur inconnue";
    return res.status(400).json({ error: "Opération impossible", detail });
  }
});

export default router;
