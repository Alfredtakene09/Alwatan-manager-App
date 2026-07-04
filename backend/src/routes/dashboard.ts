import { Router } from "express";
import {
  HospitalizationStatus,
  InvoiceStatus,
  InvoiceType,
  SurgeryStatus,
  VisitStatus,
} from "@prisma/client";
import { prisma } from "../lib/db.js";
import {
  bucketAmountByDay,
  last7DayStarts,
  startOfDay,
} from "../lib/dashboard-charts.js";
import { labsPendingApprovalWhere, labsWaitingWhere, hasUnpaidCashierQueueExams } from "../lib/lab-notes.js";
import {
  aggregateCollectedToday,
  buildRevenueLast7Days,
} from "../lib/revenue-stats.js";
import { buildAdminDashboardOverview, buildAdminNavBadges } from "../lib/admin-dashboard-stats.js";
import {
  buildGestionnaireDashboardOverview,
  buildGestionnaireNavBadges,
} from "../lib/gestionnaire-dashboard-stats.js";
import { countLowStockProducts, listPharmacyStockAlerts } from "../lib/pharmacy-alerts.js";
import { requireAuth, requireModule } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/admin", requireModule("admin"), async (_req, res) => {
  const overview = await buildAdminDashboardOverview();
  return res.json(overview);
});

router.get("/admin/nav-badges", requireModule("admin"), async (_req, res) => {
  const badges = await buildAdminNavBadges();
  return res.json(badges);
});

router.get("/gestionnaire", requireModule("gestionnaire"), async (_req, res) => {
  const overview = await buildGestionnaireDashboardOverview();
  return res.json(overview);
});

router.get("/gestionnaire/nav-badges", requireModule("gestionnaire"), async (_req, res) => {
  const badges = await buildGestionnaireNavBadges();
  return res.json(badges);
});

router.get("/reception", requireModule("reception"), async (_req, res) => {
  const todayStart = startOfDay(new Date());

  const [
    registeredToday,
    visitsToday,
    collectedToday,
    pendingPayments,
    externalQueue,
    hospitalizationsPending,
    visits,
    patients,
    revenueLast7Days,
  ] = await Promise.all([
    prisma.patient.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.visit.count({ where: { createdAt: { gte: todayStart } } }),
    aggregateCollectedToday(),
    prisma.consultation
      .findMany({
        where: labsPendingApprovalWhere(),
        select: { clinicalNotes: true },
      })
      .then((rows) => rows.filter((row) => hasUnpaidCashierQueueExams(row.clinicalNotes)).length),
    prisma.visit.count({
      where: {
        status: { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.AWAITING_ACCOUNTING] },
        patient: { category: "STANDARD" },
      },
    }),
    prisma.hospitalization.count({
      where: {
        status: {
          in: [
            HospitalizationStatus.REQUESTED,
            HospitalizationStatus.RESERVED,
            HospitalizationStatus.ACTIVE,
          ],
        },
      },
    }),
    prisma.visit.findMany({
      where: { createdAt: { gte: last7DayStarts()[0] } },
      select: { createdAt: true },
    }),
    prisma.patient.findMany({
      where: { createdAt: { gte: last7DayStarts()[0] } },
      select: { createdAt: true },
    }),
    buildRevenueLast7Days(),
  ]);

  const dayStarts = last7DayStarts();
  const activityLast7Days = dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayVisits = visits.filter((v) => v.createdAt >= dayStart && v.createdAt < dayEnd).length;
    const dayRegistrations = patients.filter((p) => p.createdAt >= dayStart && p.createdAt < dayEnd).length;
    const revenueRow = revenueLast7Days.find((row) => row.date === dayStart.toISOString().slice(0, 10));
    return {
      date: dayStart.toISOString().slice(0, 10),
      dayLabel: dayStart.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }),
      visits: dayVisits,
      registrations: dayRegistrations,
      revenueFcfa: revenueRow?.totalFcfa ?? 0,
      consultationsFcfa: revenueRow?.consultationsFcfa ?? 0,
      examsFcfa: revenueRow?.labExamsFcfa ?? 0,
    };
  });

  const femalePatients = await prisma.patient.count({ where: { gender: "F" } });
  const malePatients = await prisma.patient.count({ where: { gender: "M" } });

  return res.json({
    registeredToday,
    visitsToday,
    revenueTodayFcfa: collectedToday.totalFcfa,
    consultationsTodayFcfa: collectedToday.consultationsFcfa,
    examsTodayFcfa: collectedToday.examsFcfa,
    surgeryTodayFcfa: collectedToday.surgeryFcfa,
    hospitalizationTodayFcfa: collectedToday.hospitalizationFcfa,
    pendingPayments,
    externalQueue,
    hospitalizationsPending,
    femalePatients,
    malePatients,
    activityLast7Days,
  });
});

router.get("/medecin", requireModule("consultation"), async (req, res) => {
  const doctorId = req.user!.id;
  const todayStart = startOfDay(new Date());
  const dayStarts = last7DayStarts();

  const consultationStatuses = [
    VisitStatus.WAITING_CONSULTATION,
    VisitStatus.IN_CONSULTATION,
  ] as VisitStatus[];

  const [
    waitingConsultation,
    labsWaiting,
    labsResultsToday,
    myPatientsToday,
    consultations,
  ] = await Promise.all([
    prisma.visit.count({
      where: {
        createdAt: { gte: todayStart },
        status: { in: consultationStatuses },
        OR: [
          { assignedDoctorId: doctorId },
          { consultation: { is: { doctorId } } },
        ],
      },
    }),
    prisma.consultation.count({ where: labsWaitingWhere(doctorId) }),
    prisma.consultation.count({
      where: {
        doctorId,
        updatedAt: { gte: todayStart },
        clinicalNotes: { contains: "Résultats laboratoire" },
      },
    }),
    prisma.visit.count({
      where: {
        createdAt: { gte: todayStart },
        OR: [
          { assignedDoctorId: doctorId },
          { consultation: { is: { doctorId } } },
        ],
      },
    }),
    prisma.consultation.findMany({
      where: {
        doctorId,
        updatedAt: { gte: dayStarts[0] },
      },
      select: { updatedAt: true, clinicalNotes: true },
    }),
  ]);

  const consultationsLast7Days = dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayRows = consultations.filter((c) => c.updatedAt >= dayStart && c.updatedAt < dayEnd);
    const prescribed = dayRows.filter((c) => c.clinicalNotes?.includes("Examens prescrits")).length;
    return {
      date: dayStart.toISOString().slice(0, 10),
      dayLabel: dayStart.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }),
      consultations: dayRows.length,
      examsPrescribed: prescribed,
    };
  });

  return res.json({
    waitingConsultation,
    labsWaiting,
    labsResultsToday,
    myPatientsToday,
    consultationsLast7Days,
  });
});

router.get("/pharmacie", requireModule("pharmacie"), async (_req, res) => {
  const todayStart = startOfDay(new Date());
  const dayStarts = last7DayStarts();

  const [products, lowStock, prescriptionsToday, prescriptionsExternalToday, revenueAgg, sales, stockAlerts] =
    await Promise.all([
      prisma.product.count({ where: { active: true } }),
      countLowStockProducts(),
      prisma.prescription.count({ where: { createdAt: { gte: todayStart }, patientId: { not: null } } }),
      prisma.prescription.count({
        where: { createdAt: { gte: todayStart }, externalClientId: { not: null } },
      }),
      prisma.invoice.aggregate({
        where: {
          type: InvoiceType.PHARMACY,
          status: InvoiceStatus.PAID,
          paidAt: { gte: todayStart },
        },
        _sum: { amountFcfa: true },
      }),
      prisma.invoice.findMany({
        where: {
          type: InvoiceType.PHARMACY,
          status: InvoiceStatus.PAID,
          paidAt: { gte: dayStarts[0] },
        },
        select: { paidAt: true, amountFcfa: true, patientId: true, externalClientId: true },
      }),
      listPharmacyStockAlerts(),
    ]);

  const topLowStock = stockAlerts.slice(0, 5).map((row) => ({
    name: row.name,
    quantity: row.quantity,
    minStock: row.minStock,
    level: row.level,
  }));

  const salesLast7Days = dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    let patientFcfa = 0;
    let externalFcfa = 0;
    for (const sale of sales) {
      if (!sale.paidAt || sale.paidAt < dayStart || sale.paidAt >= dayEnd) continue;
      if (sale.externalClientId) externalFcfa += sale.amountFcfa;
      else patientFcfa += sale.amountFcfa;
    }
    return {
      date: dayStart.toISOString().slice(0, 10),
      dayLabel: dayStart.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      totalFcfa: patientFcfa + externalFcfa,
      patientFcfa,
      externalFcfa,
    };
  });

  return res.json({
    productsCount: products,
    lowStock,
    prescriptionsToday,
    prescriptionsExternalToday,
    revenueTodayFcfa: revenueAgg._sum.amountFcfa ?? 0,
    salesLast7Days,
    topLowStock,
  });
});

router.get("/laboratoire", requireModule("laboratoire"), async (_req, res) => {
  const todayStart = startOfDay(new Date());

  const [labsPending, labsInProgress, labsCompletedToday, consultations] = await Promise.all([
    prisma.consultation.count({ where: labsPendingApprovalWhere() }),
    prisma.consultation.count({ where: labsWaitingWhere() }),
    prisma.consultation.count({
      where: {
        updatedAt: { gte: todayStart },
        clinicalNotes: { contains: "Résultats laboratoire" },
      },
    }),
    prisma.consultation.findMany({
      where: {
        OR: [
          { labSentToLabAt: { gte: last7DayStarts()[0] } },
          {
            updatedAt: { gte: last7DayStarts()[0] },
            clinicalNotes: { contains: "Résultats laboratoire" },
          },
        ],
      },
      select: { labSentToLabAt: true, updatedAt: true, clinicalNotes: true },
    }),
  ]);

  const dayStarts = last7DayStarts();
  const labsLast7Days = dayStarts.map((dayStart) => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    let received = 0;
    let completed = 0;
    for (const row of consultations) {
      if (row.labSentToLabAt && row.labSentToLabAt >= dayStart && row.labSentToLabAt < dayEnd) {
        received += 1;
      }
      if (
        row.clinicalNotes?.includes("Résultats laboratoire") &&
        row.updatedAt >= dayStart &&
        row.updatedAt < dayEnd
      ) {
        completed += 1;
      }
    }
    return {
      date: dayStart.toISOString().slice(0, 10),
      dayLabel: dayStart.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }),
      received,
      completed,
    };
  });

  return res.json({
    labsPending,
    labsInProgress,
    labsCompletedToday,
    labsLast7Days,
  });
});

router.get("/soignant", requireModule("bloc-salles"), async (_req, res) => {
  const [rooms, activeHospitalizations, authorizedSurgeries, pendingSurgeries, occupiedHospitalizations] =
    await Promise.all([
    prisma.room.findMany({ where: { active: true }, select: { id: true, type: true } }),
    prisma.hospitalization.count({ where: { status: HospitalizationStatus.ACTIVE } }),
    prisma.surgeryCase.count({
      where: { status: { in: [SurgeryStatus.PAID, SurgeryStatus.AUTHORIZED, SurgeryStatus.IN_PROGRESS] } },
    }),
    prisma.surgeryCase.count({
      where: { status: { in: [SurgeryStatus.NOTIFIED, SurgeryStatus.QUOTED] } },
    }),
    prisma.hospitalization.findMany({
      where: { status: HospitalizationStatus.ACTIVE, roomId: { not: null } },
      select: { roomId: true, room: { select: { type: true } } },
    }),
  ]);

  const occupiedRoomIds = new Set(
    occupiedHospitalizations.map((row) => row.roomId).filter((id): id is string => !!id),
  );
  const roomsTotal = rooms.length;
  const roomsOccupied = occupiedRoomIds.size;
  const roomsFree = roomsTotal - roomsOccupied;
  const vipRooms = rooms.filter((room) => room.type === "VIP");
  const simpleRooms = rooms.filter((room) => room.type === "SIMPLE");
  const vipOccupied = vipRooms.filter((room) => occupiedRoomIds.has(room.id)).length;
  const simpleOccupied = simpleRooms.filter((room) => occupiedRoomIds.has(room.id)).length;

  return res.json({
    roomsTotal,
    roomsOccupied,
    roomsFree,
    bedsTotal: roomsTotal,
    bedsOccupied: roomsOccupied,
    bedsFree: roomsFree,
    activeHospitalizations,
    authorizedSurgeries,
    pendingSurgeries,
    occupancyByRoomType: [
      { label: "VIP", total: vipRooms.length, occupied: vipOccupied },
      { label: "Simple", total: simpleRooms.length, occupied: simpleOccupied },
    ],
  });
});

/** @deprecated use GET /admin */
router.get("/stats", async (_req, res) => {
  const [waitingVisits, surgeryQueue, activeBeds, lowStock] = await Promise.all([
    prisma.visit.count({ where: { status: VisitStatus.WAITING_CONSULTATION } }),
    prisma.surgeryCase.count({
      where: { status: { in: [SurgeryStatus.NOTIFIED, SurgeryStatus.QUOTED] } },
    }),
    prisma.hospitalization.count({
      where: { status: HospitalizationStatus.ACTIVE, roomId: { not: null } },
    }),
    prisma.product.count({ where: { quantity: { lte: 5 } } }),
  ]);
  return res.json({ waitingVisits, surgeryQueue, activeBeds, lowStock });
});

export default router;
