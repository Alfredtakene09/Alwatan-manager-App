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

export async function ensureDefaultBedsForRooms(
  tx: Tx,
  rooms: Array<{ id: string; type: RoomType }>,
) {
  for (const room of rooms) {
    await ensureDefaultBedsForRoom(tx, room);
  }
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

export type AvailableAdmissionBed = {
  id: string;
  code: string;
  label: string | null;
  roomId: string;
  roomName: string;
  dailyRateFcfa: number;
};

export type AvailableAdmissionRoom = {
  id: string;
  name: string;
  dailyRateFcfa: number;
  autoBedId: string | null;
  availableBeds: AvailableAdmissionBed[];
};

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
  function buildTypeOption(type: RoomType) {
    const roomsOfType = rooms.filter((room) => room.type === type && room.active);
    const availableBeds: AvailableAdmissionBed[] = [];
    const availableRooms: AvailableAdmissionRoom[] = [];

    for (const room of roomsOfType) {
      if (!isRoomAssignableForAdmission(room, hospitalizations)) continue;

      const beds = (room.beds ?? []).filter((b) => b.active);
      const freeBeds: AvailableAdmissionBed[] = beds
        .filter((bed) => !isBedOccupied(bed.id, hospitalizations))
        .map((bed) => ({
          id: bed.id,
          code: bed.code,
          label: bed.label,
          roomId: room.id,
          roomName: room.name,
          dailyRateFcfa: room.dailyRateFcfa,
        }));

      if (beds.length > 0 && freeBeds.length === 0) continue;

      availableBeds.push(...freeBeds);
      availableRooms.push({
        id: room.id,
        name: room.name,
        dailyRateFcfa: room.dailyRateFcfa,
        autoBedId: freeBeds[0]?.id ?? null,
        availableBeds: freeBeds,
      });
    }

    const firstRoom = availableRooms[0];
    const firstBed = availableBeds[0] ?? null;

    return {
      type,
      available: availableRooms.length > 0,
      availableCount:
        availableBeds.length > 0 ? availableBeds.length : availableRooms.length,
      autoRoomId: firstBed?.roomId ?? firstRoom?.id ?? null,
      autoBedId: firstBed?.id ?? firstRoom?.autoBedId ?? null,
      roomName: firstRoom?.name ?? (type === RoomType.VIP ? "Salle VIP" : "Salle simple"),
      dailyRateFcfa: firstRoom?.dailyRateFcfa ?? 0,
      availableBeds,
      availableRooms,
      blockedReason:
        type === RoomType.VIP && roomsOfType.length > 0 && availableRooms.length === 0
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
