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
import { aggregateCollectedForCashier } from "../lib/cashier-personal-stats.js";
import { buildAdminDashboardOverview, buildAdminNavBadges, resolveDashboardDateRange } from "../lib/admin-dashboard-stats.js";
import {
  buildGestionnaireDashboardOverview,
  buildGestionnaireNavBadges,
} from "../lib/gestionnaire-dashboard-stats.js";
import { countLowStockProducts, listPharmacyStockAlerts } from "../lib/pharmacy-alerts.js";
import { computePharmacyProfit } from "../lib/pharmacy-profit.js";
import { requireAuth, requireModule } from "../middleware/auth.js";
import { patientsWhoReceivedExamsWhere } from "../lib/patient-exam-stats.js";
import {
  receptionistOwnPatientsWhere,
  receptionistOwnVisitsWhere,
  receptionistScopeUserId,
} from "../lib/reception-scope.js";

const router = Router();
router.use(requireAuth);

router.get("/admin", requireModule("admin"), async (req, res) => {
  const overview = await buildAdminDashboardOverview(resolveDashboardDateRange(req.query));
  return res.json(overview);
});

router.get("/admin/nav-badges", requireModule("admin"), async (_req, res) => {
  const badges = await buildAdminNavBadges();
  return res.json(badges);
});

router.get("/gestionnaire", requireModule("gestionnaire"), async (req, res) => {
  const overview = await buildGestionnaireDashboardOverview(resolveDashboardDateRange(req.query));
  return res.json(overview);
});

router.get("/gestionnaire/nav-badges", requireModule("gestionnaire"), async (_req, res) => {
  const badges = await buildGestionnaireNavBadges();
  return res.json(badges);
});

router.get("/reception", requireModule("reception"), async (req, res) => {
  const user = req.user!;
  const createdById = String(req.query.createdById ?? "").trim();
  const service = String(req.query.service ?? "").trim();
  const todayStart = startOfDay(new Date());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const ownPatients = {
    ...receptionistOwnPatientsWhere(user, createdById),
    ...(service ? { service } : {}),
  };
  const ownVisitsBase = receptionistOwnVisitsWhere(user, createdById);
  const ownVisits: typeof ownVisitsBase =
    service
      ? {
          AND: [
            ownVisitsBase,
            { patient: { service } },
          ],
        }
      : ownVisitsBase;
  const scopedCashierId = receptionistScopeUserId(user, createdById);
  const revenueOptions = service ? { patientService: service } : undefined;
  const weekStart = last7DayStarts()[0] ?? todayStart;

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
    prisma.patient.count({ where: { ...ownPatients, createdAt: { gte: todayStart } } }),
    prisma.visit.count({
      where: { createdAt: { gte: todayStart }, ...ownVisits },
    }),
    scopedCashierId
      ? aggregateCollectedForCashier(scopedCashierId, todayStart, tomorrowStart, revenueOptions)
      : aggregateCollectedToday(revenueOptions),
    prisma.consultation
      .findMany({
        where: labsPendingApprovalWhere(),
        select: { clinicalNotes: true },
      })
      .then((rows) => rows.filter((row) => hasUnpaidCashierQueueExams(row.clinicalNotes)).length),
    prisma.visit.count({
      where: {
        status: { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.AWAITING_ACCOUNTING] },
        patient: { category: "STANDARD", ...ownPatients },
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
        ...(Object.keys(ownVisitsBase).length || service
          ? { visit: ownVisits }
          : {}),
      },
    }),
    prisma.visit.findMany({
      where: { createdAt: { gte: weekStart }, ...ownVisits },
      select: { createdAt: true },
    }),
    prisma.patient.findMany({
      where: { createdAt: { gte: weekStart }, ...ownPatients },
      select: { createdAt: true },
    }),
    buildRevenueLast7Days(scopedCashierId ? { cashierId: scopedCashierId } : undefined),
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

  const [femalePatients, malePatients, examPatientsCount] = await Promise.all([
    prisma.patient.count({ where: { ...ownPatients, gender: "F" } }),
    prisma.patient.count({ where: { ...ownPatients, gender: "M" } }),
    prisma.patient.count({ where: patientsWhoReceivedExamsWhere(ownPatients) }),
  ]);

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
    examPatientsCount,
    activityLast7Days,
    serviceFilter: service || null,
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

function parseDashboardDay(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return fallback;
  }
  const [year, month, day] = value.trim().split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return startOfDay(parsed);
}

function toIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

router.get("/pharmacie", requireModule("pharmacie"), async (req, res) => {
  const user = req.user!;
  const ownSalesOnly = user.role === "PHARMACIEN";
  const requestedPharmacistId =
    typeof req.query.pharmacistId === "string" && req.query.pharmacistId.trim()
      ? req.query.pharmacistId.trim()
      : undefined;
  const pharmacistId = ownSalesOnly ? user.id : requestedPharmacistId;
  const pharmacistFilter = pharmacistId ? { pharmacistId } : {};

  const todayStart = startOfDay(new Date());
  const dayStarts = last7DayStarts();
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const weekFrom = dayStarts[0];
  let summaryFrom = parseDashboardDay(req.query.from, todayStart);
  let summaryToStart = parseDashboardDay(req.query.to, todayStart);
  if (summaryToStart < summaryFrom) {
    const swapped = summaryFrom;
    summaryFrom = summaryToStart;
    summaryToStart = swapped;
  }
  const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
  if (summaryToStart.getTime() - summaryFrom.getTime() > maxRangeMs) {
    summaryFrom = new Date(summaryToStart);
    summaryFrom.setDate(summaryFrom.getDate() - 366);
  }
  const summaryToExclusive = new Date(summaryToStart);
  summaryToExclusive.setDate(summaryToExclusive.getDate() + 1);
  const salesPeriodWhere = {
    createdAt: { gte: summaryFrom, lt: summaryToExclusive },
    ...pharmacistFilter,
  };

  const [
    products,
    lowStock,
    prescriptionsToday,
    prescriptionsExternalToday,
    revenueAgg,
    sales,
    stockAlerts,
    profitToday,
    profitWeek,
    weekPrescriptions,
    weekLineAgg,
    weekReturnsAgg,
  ] = await Promise.all([
      prisma.product.count({ where: { active: true } }),
      countLowStockProducts(),
      prisma.prescription.count({
        where: {
          createdAt: { gte: todayStart },
          patientId: { not: null },
          ...pharmacistFilter,
        },
      }),
      prisma.prescription.count({
        where: {
          createdAt: { gte: todayStart },
          externalClientId: { not: null },
          ...pharmacistFilter,
        },
      }),
      prisma.invoice.aggregate({
        where: {
          type: InvoiceType.PHARMACY,
          status: InvoiceStatus.PAID,
          paidAt: { gte: todayStart },
          ...(pharmacistId ? { issuedById: pharmacistId } : {}),
        },
        _sum: { amountFcfa: true },
      }),
      prisma.invoice.findMany({
        where: {
          type: InvoiceType.PHARMACY,
          status: InvoiceStatus.PAID,
          paidAt: { gte: weekFrom },
          ...(pharmacistId ? { issuedById: pharmacistId } : {}),
        },
        select: { paidAt: true, amountFcfa: true, patientId: true, externalClientId: true },
      }),
      listPharmacyStockAlerts(),
      computePharmacyProfit(todayStart, tomorrow, pharmacistId ? { pharmacistId } : undefined),
      computePharmacyProfit(weekFrom, tomorrow, pharmacistId ? { pharmacistId } : undefined),
      prisma.prescription.findMany({
        where: salesPeriodWhere,
        select: { grossTotalFcfa: true, netTotalFcfa: true },
      }),
      prisma.pharmacySaleLine.aggregate({
        where: { prescription: salesPeriodWhere },
        _sum: { quantity: true },
      }),
      prisma.pharmacySaleReturn.aggregate({
        where: {
          createdAt: { gte: summaryFrom, lt: summaryToExclusive },
          prescription: pharmacistFilter,
        },
        _sum: { netRefundFcfa: true },
        _count: { _all: true },
      }),
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

  let grossTotalFcfa = 0;
  let netTotalFcfa = 0;
  let freeSalesCount = 0;
  for (const row of weekPrescriptions) {
    const gross = row.grossTotalFcfa ?? row.netTotalFcfa ?? 0;
    const net = row.netTotalFcfa ?? gross;
    grossTotalFcfa += gross;
    netTotalFcfa += net;
    if (net <= 0 && gross > 0) freeSalesCount += 1;
  }
  const reductionFcfa = Math.max(0, grossTotalFcfa - netTotalFcfa);
  const salesSummary = {
    from: toIsoDay(summaryFrom),
    to: toIsoDay(summaryToStart),
    salesCount: weekPrescriptions.length,
    productsSoldCount: weekLineAgg._sum.quantity ?? 0,
    grossTotalFcfa,
    reductionFcfa,
    netTotalFcfa,
    freeSalesCount,
    returnsCount: weekReturnsAgg._count._all,
    returnsNetFcfa: weekReturnsAgg._sum.netRefundFcfa ?? 0,
  };

  return res.json({
    productsCount: products,
    lowStock,
    prescriptionsToday,
    prescriptionsExternalToday,
    revenueTodayFcfa: revenueAgg._sum.amountFcfa ?? 0,
    salesLast7Days,
    salesSummary,
    topLowStock,
    profitToday,
    profitWeek,
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
