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

export async function assertRoomAvailableForAdmission(
  tx: Tx,
  roomId: string,
  hospitalizationId: string,
) {
  const room = await tx.room.findUniqueOrThrow({
    where: { id: roomId },
  });

  if (!room.active) {
    throw new Error("ROOM_UNAVAILABLE");
  }

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
      include: {
        visit: { include: { patient: true } },
        room: true,
      },
    });
    if (activeVip) {
      throw new Error("VIP_ROOM_OCCUPIED");
    }
  }

  return room;
}

export function isRoomOccupied(
  roomId: string,
  hospitalizations: Array<{ roomId: string | null; status: HospitalizationStatus }>,
) {
  return hospitalizations.some(
    (h) =>
      h.roomId === roomId &&
      BLOCKING_HOSP_STATUSES.includes(h.status as (typeof BLOCKING_HOSP_STATUSES)[number]),
  );
}

export function isRoomAssignableForAdmission(
  room: { id: string; active: boolean; type: RoomType },
  hospitalizations: Array<{ roomId: string | null; status: HospitalizationStatus }>,
) {
  if (!room.active) return false;
  return !isRoomOccupied(room.id, hospitalizations);
}

export function enrichRoomsWithStatus<
  TRoom extends { id: string; active: boolean; type: RoomType; name: string; dailyRateFcfa: number },
>(
  rooms: TRoom[],
  hospitalizations: Array<{
    roomId: string | null;
    status: HospitalizationStatus;
    visit?: { patient: { firstName: string; lastName: string } };
  }>,
) {
  return rooms.map((room) => {
    const activeHosp = hospitalizations.find(
      (h) =>
        h.roomId === room.id &&
        BLOCKING_HOSP_STATUSES.includes(h.status as (typeof BLOCKING_HOSP_STATUSES)[number]),
    );
    return {
      ...room,
      status: activeHosp ? ("OCCUPE" as const) : ("LIBRE" as const),
      currentPatient: activeHosp?.visit?.patient ?? null,
    };
  });
}

export function computeRoomTypeAvailability(
  rooms: Array<{ id: string; active: boolean; type: RoomType; name: string; dailyRateFcfa: number }>,
  hospitalizations: Array<{
    status: HospitalizationStatus;
    roomType: RoomType;
    roomId: string | null;
    room?: { type: RoomType } | null;
  }>,
) {
  const assignableRooms = rooms.filter((room) =>
    isRoomAssignableForAdmission(room, hospitalizations),
  );

  const hasActiveVipPatient = hospitalizations.some(
    (h) =>
      h.status === HospitalizationStatus.ACTIVE &&
      (h.room?.type === RoomType.VIP || h.roomType === RoomType.VIP) &&
      h.roomId,
  );

  function buildTypeOption(type: RoomType) {
    const roomsOfType =
      type === RoomType.VIP && hasActiveVipPatient
        ? []
        : assignableRooms.filter((room) => room.type === type);
    const firstRoom = roomsOfType[0];
    return {
      type,
      available: roomsOfType.length > 0,
      availableCount: roomsOfType.length,
      autoRoomId: firstRoom?.id ?? null,
      roomName: firstRoom?.name ?? (type === RoomType.VIP ? "Salle VIP" : "Salle simple"),
      dailyRateFcfa: firstRoom?.dailyRateFcfa ?? 0,
      blockedReason:
        type === RoomType.VIP && hasActiveVipPatient && roomsOfType.length === 0
          ? "VIP_OCCUPIED"
          : null,
    };
  }

  return {
    VIP: buildTypeOption(RoomType.VIP),
    SIMPLE: buildTypeOption(RoomType.SIMPLE),
  };
}
