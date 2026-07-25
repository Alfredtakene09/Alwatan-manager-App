import {
  HospitalizationStatus,
  RoomType,
  type Prisma,
} from "@prisma/client";

type Tx = Prisma.TransactionClient;

const BLOCKING_HOSP_STATUSES = [
  HospitalizationStatus.ACTIVE,
  HospitalizationStatus.RESERVED,
] as const;

type OccupancyRow = {
  id: string;
  roomId: string | null;
  bedId: string | null;
  status: HospitalizationStatus;
  roomType: RoomType;
  room?: { type: RoomType } | null;
  visit?: { patient: { firstName: string; lastName: string } };
};

export function defaultBedCodesForRoomType(type: RoomType): string[] {
  return type === RoomType.VIP ? ["L1"] : ["L1", "L2"];
}

export async function ensureDefaultBedsForRoom(
  tx: Tx,
  room: { id: string; type: RoomType },
) {
  const existing = await tx.bed.count({ where: { roomId: room.id } });
  if (existing > 0) return;

  const codes = defaultBedCodesForRoomType(room.type);
  await tx.bed.createMany({
    data: codes.map((code) => ({
      roomId: room.id,
      code,
      label: `Lit ${code}`,
      active: true,
    })),
  });
}

export async function assertBedAvailableForAdmission(
  tx: Tx,
  bedId: string,
  hospitalizationId: string,
) {
  const bed = await tx.bed.findUniqueOrThrow({
    where: { id: bedId },
    include: { room: true },
  });

  if (!bed.active || !bed.room.active) {
    throw new Error("BED_UNAVAILABLE");
  }

  const conflictOnBed = await tx.hospitalization.findFirst({
    where: {
      bedId,
      status: { in: [...BLOCKING_HOSP_STATUSES] },
      id: { not: hospitalizationId },
    },
  });
  if (conflictOnBed) {
    throw new Error("BED_UNAVAILABLE");
  }

  if (bed.room.type === RoomType.VIP) {
    const activeVip = await tx.hospitalization.findFirst({
      where: {
        id: { not: hospitalizationId },
        status: HospitalizationStatus.ACTIVE,
        room: { type: RoomType.VIP, active: true },
      },
    });
    if (activeVip) {
      throw new Error("VIP_ROOM_OCCUPIED");
    }
  }

  return bed;
}

export async function assertRoomAvailableForAdmission(
  tx: Tx,
  roomId: string,
  hospitalizationId: string,
  options?: { bedId?: string | null },
) {
  const room = await tx.room.findUniqueOrThrow({
    where: { id: roomId },
    include: { beds: { where: { active: true }, orderBy: { code: "asc" } } },
  });

  if (!room.active) {
    throw new Error("ROOM_UNAVAILABLE");
  }

  if (options?.bedId) {
    const bed = await assertBedAvailableForAdmission(tx, options.bedId, hospitalizationId);
    if (bed.roomId !== roomId) {
      throw new Error("BED_ROOM_MISMATCH");
    }
    return { room, bed };
  }

  if (room.beds.length > 0) {
    const occupiedBedIds = new Set(
      (
        await tx.hospitalization.findMany({
          where: {
            bedId: { in: room.beds.map((b) => b.id) },
            status: { in: [...BLOCKING_HOSP_STATUSES] },
            id: { not: hospitalizationId },
          },
          select: { bedId: true },
        })
      )
        .map((h) => h.bedId)
        .filter((id): id is string => Boolean(id)),
    );

    const freeBed = room.beds.find((b) => !occupiedBedIds.has(b.id));
    if (!freeBed) {
      throw new Error("ROOM_UNAVAILABLE");
    }

    if (room.type === RoomType.VIP) {
      const activeVip = await tx.hospitalization.findFirst({
        where: {
          id: { not: hospitalizationId },
          status: HospitalizationStatus.ACTIVE,
          room: { type: RoomType.VIP, active: true },
        },
      });
      if (activeVip) {
        throw new Error("VIP_ROOM_OCCUPIED");
      }
    }

    return { room, bed: freeBed };
  }

  // Legacy : salle sans lits → occupation exclusive de la salle
  const conflictOnRoom = await tx.hospitalization.findFirst({
    where: {
      roomId,
      status: { in: [...BLOCKING_HOSP_STATUSES] },
      id: { not: hospitalizationId },
    },
  });
  if (conflictOnRoom) {
    throw new Error("ROOM_UNAVAILABLE");
  }

  if (room.type === RoomType.VIP) {
    const activeVip = await tx.hospitalization.findFirst({
      where: {
        id: { not: hospitalizationId },
        status: HospitalizationStatus.ACTIVE,
        room: { type: RoomType.VIP, active: true },
      },
    });
    if (activeVip) {
      throw new Error("VIP_ROOM_OCCUPIED");
    }
  }

  return { room, bed: null };
}

export function isBedOccupied(
  bedId: string,
  hospitalizations: Array<{ bedId?: string | null; status: HospitalizationStatus }>,
) {
  return hospitalizations.some(
    (h) =>
      h.bedId === bedId &&
      BLOCKING_HOSP_STATUSES.includes(h.status as (typeof BLOCKING_HOSP_STATUSES)[number]),
  );
}

export function isRoomOccupied(
  roomId: string,
  hospitalizations: Array<{ roomId: string | null; status: HospitalizationStatus; bedId?: string | null }>,
  roomBeds?: Array<{ id: string; active: boolean }>,
) {
  if (roomBeds && roomBeds.length > 0) {
    const activeBeds = roomBeds.filter((b) => b.active);
    if (activeBeds.length === 0) return true;
    return activeBeds.every((bed) => isBedOccupied(bed.id, hospitalizations));
  }

  return hospitalizations.some(
    (h) =>
      h.roomId === roomId &&
      BLOCKING_HOSP_STATUSES.includes(h.status as (typeof BLOCKING_HOSP_STATUSES)[number]),
  );
}

export function isRoomAssignableForAdmission(
  room: { id: string; active: boolean; type: RoomType; beds?: Array<{ id: string; active: boolean }> },
  hospitalizations: Array<{ roomId: string | null; bedId?: string | null; status: HospitalizationStatus }>,
) {
  if (!room.active) return false;
  return !isRoomOccupied(room.id, hospitalizations, room.beds);
}

export function enrichRoomsWithStatus<
  TRoom extends {
    id: string;
    active: boolean;
    type: RoomType;
    name: string;
    dailyRateFcfa: number;
    beds?: Array<{ id: string; code: string; label: string | null; active: boolean }>;
  },
>(
  rooms: TRoom[],
  hospitalizations: OccupancyRow[],
) {
  return rooms.map((room) => {
    const beds = room.beds ?? [];
    const occupied = isRoomOccupied(room.id, hospitalizations, beds);
    const activeHosp = hospitalizations.find(
      (h) =>
        h.roomId === room.id &&
        BLOCKING_HOSP_STATUSES.includes(h.status as (typeof BLOCKING_HOSP_STATUSES)[number]),
    );

    const bedsWithStatus = beds.map((bed) => {
      const bedHosp = hospitalizations.find(
        (h) =>
          h.bedId === bed.id &&
          BLOCKING_HOSP_STATUSES.includes(h.status as (typeof BLOCKING_HOSP_STATUSES)[number]),
      );
      return {
        ...bed,
        status: !bed.active
          ? ("INACTIF" as const)
          : bedHosp
            ? ("OCCUPE" as const)
            : ("LIBRE" as const),
        currentPatient: bedHosp?.visit?.patient ?? null,
      };
    });

    const freeBedCount = bedsWithStatus.filter((b) => b.status === "LIBRE").length;

    return {
      ...room,
      status: occupied ? ("OCCUPE" as const) : ("LIBRE" as const),
      currentPatient: activeHosp?.visit?.patient ?? null,
      beds: bedsWithStatus,
      freeBedCount,
      bedCount: beds.length,
    };
  });
}

export function enrichRoomTypeAvailabilityWithBeds(
  rooms: Array<{
    id: string;
    active: boolean;
    type: RoomType;
    name: string;
    dailyRateFcfa: number;
    beds?: Array<{ id: string; code: string; label: string | null; active: boolean }>;
  }>,
  hospitalizations: OccupancyRow[],
) {
  const hasActiveVipPatient = hospitalizations.some(
    (h) =>
      h.status === HospitalizationStatus.ACTIVE &&
      (h.room?.type === RoomType.VIP || h.roomType === RoomType.VIP) &&
      h.roomId,
  );

  function buildTypeOption(type: RoomType) {
    const roomsOfType = rooms.filter((room) => room.type === type && room.active);
    const availableBeds: Array<{
      id: string;
      code: string;
      label: string | null;
      roomId: string;
      roomName: string;
      dailyRateFcfa: number;
    }> = [];

    for (const room of roomsOfType) {
      if (type === RoomType.VIP && hasActiveVipPatient) continue;

      const beds = (room.beds ?? []).filter((b) => b.active);
      if (beds.length > 0) {
        for (const bed of beds) {
          if (!isBedOccupied(bed.id, hospitalizations)) {
            availableBeds.push({
              id: bed.id,
              code: bed.code,
              label: bed.label,
              roomId: room.id,
              roomName: room.name,
              dailyRateFcfa: room.dailyRateFcfa,
            });
          }
        }
      } else if (isRoomAssignableForAdmission(room, hospitalizations)) {
        // Legacy room without beds: expose a synthetic slot via autoRoomId only
      }
    }

    const assignableRooms = roomsOfType.filter((room) => {
      if (type === RoomType.VIP && hasActiveVipPatient) return false;
      return isRoomAssignableForAdmission(room, hospitalizations);
    });

    const firstRoom = assignableRooms[0];
    const firstBed = availableBeds[0] ?? null;

    return {
      type,
      available: assignableRooms.length > 0,
      availableCount:
        availableBeds.length > 0 ? availableBeds.length : assignableRooms.length,
      autoRoomId: firstBed?.roomId ?? firstRoom?.id ?? null,
      autoBedId: firstBed?.id ?? null,
      roomName: firstBed?.roomName ?? firstRoom?.name ?? (type === RoomType.VIP ? "Salle VIP" : "Salle simple"),
      dailyRateFcfa: firstBed?.dailyRateFcfa ?? firstRoom?.dailyRateFcfa ?? 0,
      availableBeds,
      blockedReason:
        type === RoomType.VIP && hasActiveVipPatient && assignableRooms.length === 0
          ? ("VIP_OCCUPIED" as const)
          : null,
    };
  }

  return {
    VIP: buildTypeOption(RoomType.VIP),
    SIMPLE: buildTypeOption(RoomType.SIMPLE),
  };
}

/** @deprecated Prefer enrichRoomTypeAvailabilityWithBeds — kept for callers expecting the old shape. */
export function computeRoomTypeAvailability(
  rooms: Array<{
    id: string;
    active: boolean;
    type: RoomType;
    name: string;
    dailyRateFcfa: number;
    beds?: Array<{ id: string; code: string; label: string | null; active: boolean }>;
  }>,
  hospitalizations: OccupancyRow[],
) {
  return enrichRoomTypeAvailabilityWithBeds(rooms, hospitalizations);
}
