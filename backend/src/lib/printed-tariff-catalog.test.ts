import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRINTED_TARIFF_EMIRATES_SUFFIX,
  PRINTED_TARIFF_KINE,
  PRINTED_TARIFF_OPERATIONS,
  PRINTED_TARIFF_RADIO,
  PRINTED_TARIFF_SERVICES,
} from "./printed-tariff-catalog.js";

describe("catalogue tarifaire papier", () => {
  it("définit les opérations gynéco / ortho aux tarifs demandés (FCFA)", () => {
    const byCode = Object.fromEntries(
      PRINTED_TARIFF_OPERATIONS.map((item) => [item.code, item]),
    );
    assert.equal(byCode["OP-GYN-CESAR"]?.label, "Césariennes");
    assert.equal(byCode["OP-GYN-CESAR"]?.totalCostFcfa, 450_000);
    assert.equal(byCode["OP-GYN-CESAR"]?.emiratesCostFcfa, 350_000);
    assert.equal(byCode["OP-GYN-ACCOUCH-NAT"]?.totalCostFcfa, 50_000);
    assert.equal(byCode["OP-GYN-ACCOUCH-NAT"]?.emiratesCostFcfa, 25_000);
    assert.equal(byCode["OP-GYN-FIBROME"]?.totalCostFcfa, 500_000);
    assert.equal(byCode["OP-GYN-FIBROME"]?.emiratesCostFcfa, 80_000);
    assert.equal(byCode["OP-ORTHO-HANCHE"]?.totalCostFcfa, 750_000);
    assert.equal(byCode["OP-ORTHO-BASSIN"]?.totalCostFcfa, 900_000);
    assert.equal(byCode["OP-ORTHO-BRAS"]?.totalCostFcfa, 500_000);
    assert.equal(byCode["OP-ORTHO-JAMBE"]?.totalCostFcfa, 600_000);
    assert.equal(byCode["OP-ORTHO-JAMBE"]?.emiratesCostFcfa, 500_000);
  });

  it("définit radio et kiné (tarif standard)", () => {
    const radio = Object.fromEntries(PRINTED_TARIFF_RADIO.map((item) => [item.code, item]));
    assert.equal(radio["radio-couleur"]?.priceFcfa, 75_000);
    assert.equal(radio["radio-couleur"]?.emiratesPriceFcfa, 60_000);
    assert.equal(radio["radio-simple"]?.priceFcfa, 10_000);
    assert.equal(radio["radio-simple"]?.emiratesPriceFcfa, 5_000);
    assert.equal(PRINTED_TARIFF_KINE[0]?.label, "Consultation de kinésithérapie");
    assert.equal(PRINTED_TARIFF_KINE[0]?.priceFcfa, 10_000);
    assert.equal(PRINTED_TARIFF_KINE[0]?.emiratesPriceFcfa, 5_000);
  });

  it("n’injecte plus de variante « émiraties » dans le catalogue", () => {
    const codes = [
      ...PRINTED_TARIFF_OPERATIONS.map((item) => item.code),
      ...PRINTED_TARIFF_RADIO.map((item) => item.code),
      ...PRINTED_TARIFF_KINE.map((item) => item.code),
    ];
    assert.equal(new Set(codes).size, codes.length);
    assert.ok(codes.every((code) => !code.endsWith("-EM")));
    assert.equal(PRINTED_TARIFF_EMIRATES_SUFFIX, " (émiraties)");
    assert.deepEqual([...PRINTED_TARIFF_SERVICES], ["Orthopédie", "Kinésithérapie"]);
  });
});
