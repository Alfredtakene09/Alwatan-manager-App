import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HospitalizationStatus, RoomType } from "@prisma/client";
import { computeRoomTypeAvailability, dailyRateForRoomType, stayEndedOn } from "./hospitalization-rooms.js";

describe("disponibilité des salles à l'admission", () => {
  it("liste chaque salle libre, y compris une salle sans lits", () => {
    const rooms = [
      {
        id: "simple-old",
        active: true,
        type: RoomType.SIMPLE,
        name: "Salle A",
        dailyRateFcfa: 25000,
        beds: [
          { id: "bed-a1", code: "L1", label: "Lit L1", active: true },
          { id: "bed-a2", code: "L2", label: "Lit L2", active: true },
        ],
      },
      {
        id: "simple-new",
        active: true,
        type: RoomType.SIMPLE,
        name: "Salle neuve",
        dailyRateFcfa: 18000,
        beds: [],
      },
    ];

    const availability = computeRoomTypeAvailability(rooms, []);
    const names = availability.SIMPLE.availableRooms.map((room) => room.name);

    assert.deepEqual(names, ["Salle A", "Salle neuve"]);
    assert.equal(availability.SIMPLE.availableRooms.length, 2);
    assert.ok(availability.SIMPLE.availableRooms.some((room) => room.id === "simple-new"));
  });

  it("n'occulte pas une autre chambre VIP quand une VIP est occupée", () => {
    const rooms = [
      {
        id: "vip-1",
        active: true,
        type: RoomType.VIP,
        name: "VIP 1",
        dailyRateFcfa: 50000,
        beds: [{ id: "vip-1-l1", code: "L1", label: "Lit L1", active: true }],
      },
      {
        id: "vip-2",
        active: true,
        type: RoomType.VIP,
        name: "VIP 2",
        dailyRateFcfa: 50000,
        beds: [{ id: "vip-2-l1", code: "L1", label: "Lit L1", active: true }],
      },
    ];
    const hospitalizations = [
      {
        id: "h1",
        roomId: "vip-1",
        bedId: "vip-1-l1",
        status: HospitalizationStatus.ACTIVE,
        roomType: RoomType.VIP,
        room: { type: RoomType.VIP },
      },
    ];

    const availability = computeRoomTypeAvailability(rooms, hospitalizations);

    assert.equal(availability.VIP.availableRooms.length, 1);
    assert.equal(availability.VIP.availableRooms[0]?.id, "vip-2");
    assert.equal(availability.VIP.blockedReason, null);
    assert.equal(availability.VIP.dailyRateFcfa, 20_000);
    assert.equal(availability.SIMPLE.dailyRateFcfa, 5_000);
  });

  it("libère une salle dont la date de sortie est atteinte", () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    assert.equal(stayEndedOn(start, today), true);
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(stayEndedOn(tomorrow, today), false);
    assert.equal(dailyRateForRoomType(RoomType.VIP), 20_000);
    assert.equal(dailyRateForRoomType(RoomType.SIMPLE), 5_000);
  });
});
