import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requireAuth, requireModule } from "../middleware/auth.js";
import { enrichRoomsWithStatus } from "../lib/hospitalization-rooms.js";

const router = Router();
router.use(requireAuth, requireModule("bloc-salles"));

router.get("/", async (_req, res) => {
  const [rooms, surgeries, hospitalizations] = await Promise.all([
    prisma.room.findMany({
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
      where: { status: "ACTIVE" },
      include: {
        visit: { include: { patient: true } },
        room: true,
      },
    }),
  ]);

  const roomsWithStatus = enrichRoomsWithStatus(rooms, hospitalizations);

  return res.json({ rooms: roomsWithStatus, surgeries, hospitalizations });
});

export default router;
