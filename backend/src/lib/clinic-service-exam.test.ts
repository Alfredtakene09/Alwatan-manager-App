import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExamCatalogKind } from "@prisma/client";
import {
  examCatalogVisibleForServiceWhere,
  examCatalogWhereForServiceTab,
} from "./clinic-service-exam.js";

describe("nomenclature examens par service", () => {
  it("inclut Odonto/Radio/Écho même rattachés à un service (prescription)", () => {
    const where = examCatalogVisibleForServiceWhere(["svc-kine"]);
    const or = Array.isArray(where.OR) ? where.OR : [];
    assert.ok(
      or.some(
        (clause) =>
          clause.kind &&
          typeof clause.kind === "object" &&
          "in" in clause.kind &&
          Array.isArray(clause.kind.in) &&
          clause.kind.in.includes(ExamCatalogKind.ODONTO) &&
          clause.kind.in.includes(ExamCatalogKind.RADIO) &&
          clause.kind.in.includes(ExamCatalogKind.ECHO),
      ),
      "Radio/Écho/Odonto doivent rester visibles hors services de spécialité",
    );
  });

  it("l’onglet Odontologie montre les actes liés et la nomenclature odonto globale", () => {
    const where = examCatalogWhereForServiceTab({
      id: "svc-odonto",
      name: "Odontologie",
    });
    assert.deepEqual(where, {
      OR: [
        { clinicServiceId: "svc-odonto" },
        { kind: ExamCatalogKind.ODONTO, clinicServiceId: null },
      ],
    });
  });

  it("l’onglet d’une spécialité ne mélange pas la nomenclature globale odonto", () => {
    const where = examCatalogWhereForServiceTab({
      id: "svc-ophta",
      name: "Ophtalmologie",
    });
    assert.deepEqual(where, { clinicServiceId: "svc-ophta" });
  });
});
