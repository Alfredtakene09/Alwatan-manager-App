import { Router } from "express";
import { HospitalizationStatus, InvoiceStatus } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireAuth, requireModule } from "../middleware/auth.js";
import {
  computeRoomTypeAvailability,
  enrichRoomsWithStatus,
  prepareHospitalizationRooms,
} from "../lib/hospitalization-rooms.js";
import { releaseSettledHospitalizationsThrottled } from "../lib/hospitalization-auto-release.js";

const router = Router();
router.use(requireAuth, requireModule("bloc-salles"));

router.get("/", async (_req, res) => {
  await releaseSettledHospitalizationsThrottled();
  await prepareHospitalizationRooms(prisma);

  const [rooms, surgeries, hospitalizations, paidInvoices] = await Promise.all([
    prisma.room.findMany({
      include: { beds: { orderBy: { code: "asc" } } },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.surgeryCase.findMany({
      where: { status: { in: ["PAID", "AUTHORIZED", "IN_PROGRESS"] } },
      include: {
        visit: { include: { patient: true } },
        interventionType: true,
        surgeon: true,
      },
      orderBy: { authorizedAt: "desc" },
    }),
    prisma.hospitalization.findMany({
      where: {
        status: { in: [HospitalizationStatus.ACTIVE, HospitalizationStatus.RESERVED] },
        roomId: { not: null },
      },
      include: {
        visit: { include: { patient: true } },
        room: true,
        bed: true,
      },
    }),
    prisma.invoice.groupBy({
      by: ["hospitalizationId"],
      where: {
        status: InvoiceStatus.PAID,
        hospitalizationId: { not: null },
      },
      _sum: { paidAmountFcfa: true },
    }),
  ]);

  const paidById = new Map(
    paidInvoices
      .filter((row) => row.hospitalizationId)
      .map((row) => [row.hospitalizationId as string, row._sum.paidAmountFcfa ?? 0]),
  );

  const hospitalizationsWithPaid = hospitalizations.map((row) => ({
    ...row,
    paidFcfa: row.paidAt
      ? Math.max(paidById.get(row.id) ?? 0, row.totalDueFcfa)
      : (paidById.get(row.id) ?? 0),
  }));

  const roomsWithStatus = enrichRoomsWithStatus(rooms, hospitalizationsWithPaid);
  const roomAvailability = computeRoomTypeAvailability(rooms, hospitalizationsWithPaid);

  return res.json({
    rooms: roomsWithStatus,
    surgeries,
    hospitalizations: hospitalizationsWithPaid,
    roomAvailability,
  });
});

export default router;
