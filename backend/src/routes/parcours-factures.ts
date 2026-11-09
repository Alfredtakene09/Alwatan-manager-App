import { Router } from "express";
import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { buildExamSheetsByKind } from "../lib/exam-billing.js";
import { EXAM_KIND_SECTION_LABELS, paidExamLabels, type ExamKindSlug } from "../lib/lab-notes.js";
import { getLabExamPriceFcfa, refreshExamPriceCache } from "../lib/lab-exam-prices.js";
import { requireAuth, requireAnyModule } from "../middleware/auth.js";

/**
 * Facture unique par parcours patient (visite) : regroupe consultation, examens,
 * opération, hospitalisation et pharmacie en un seul document imprimable.
 */
const router = Router();
router.use(requireAuth);
router.use(requireAnyModule("comptabilite"));

const ACTIVE_INVOICE: Prisma.InvoiceWhereInput = { status: { not: InvoiceStatus.CANCELLED } };

const invoiceInclude = {
  issuedBy: { select: { firstName: true, lastName: true } },
  pharmacyLines: {
    select: {
      quantity: true,
      unitPriceFcfa: true,
      lineTotalFcfa: true,
      product: { select: { name: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

type VisitRef = { id: string; patientId: string; createdAt: Date };

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Factures du patient sans visite (ex. vente pharmacie) : rattachées à la visite
 * du même jour la plus récente avant la facture (ou la première du jour).
 */
async function loadOrphanInvoicesByVisit(visits: VisitRef[]) {
  const result = new Map<string, InvoiceRow[]>();
  if (!visits.length) return result;
  const patientIds = [...new Set(visits.map((v) => v.patientId))];
  const minTime = Math.min(...visits.map((v) => v.createdAt.getTime()));
  const maxTime = Math.max(...visits.map((v) => v.createdAt.getTime()));
  const from = new Date(minTime);
  from.setHours(0, 0, 0, 0);
  const to = new Date(maxTime);
  to.setHours(23, 59, 59, 999);

  const orphans = await prisma.invoice.findMany({
    where: {
      ...ACTIVE_INVOICE,
      visitId: null,
      patientId: { in: patientIds },
      createdAt: { gte: from, lte: to },
    },
    include: invoiceInclude,
    orderBy: { createdAt: "asc" },
  });
  if (!orphans.length) return result;

  // Toutes les visites des patients concernés sur la période, pour un rattachement exact.
  const allVisits = await prisma.visit.findMany({
    where: { patientId: { in: patientIds }, createdAt: { gte: from, lte: to } },
    select: { id: true, patientId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  for (const invoice of orphans) {
    const sameDay = allVisits.filter(
      (v) => v.patientId === invoice.patientId && dayKey(v.createdAt) === dayKey(invoice.createdAt),
    );
    if (!sameDay.length) continue;
    const before = sameDay.filter((v) => v.createdAt <= invoice.createdAt);
    const target = before.length ? before[before.length - 1] : sameDay[0];
    const list = result.get(target.id) ?? [];
    list.push(invoice);
    result.set(target.id, list);
  }
  return result;
}

function invoiceTotals(invoices: Array<{ amountFcfa: number; paidAmountFcfa: number }>) {
  const totalFcfa = invoices.reduce((s, i) => s + Math.max(0, i.amountFcfa), 0);
  const paidFcfa = invoices.reduce((s, i) => s + Math.max(0, Math.min(i.paidAmountFcfa, i.amountFcfa)), 0);
  return { totalFcfa, paidFcfa, remainingFcfa: Math.max(0, totalFcfa - paidFcfa) };
}

function sectionOf(type: InvoiceType): string {
  switch (type) {
    case InvoiceType.CONSULTATION:
      return "consultation";
    case InvoiceType.LAB_EXAM:
      return "examens";
    case InvoiceType.SURGERY:
      return "operation";
    case InvoiceType.HOSPITALIZATION_DEPOSIT:
    case InvoiceType.HOSPITALIZATION_FINAL:
      return "hospitalisation";
    case InvoiceType.PHARMACY:
      return "pharmacie";
    default:
      return "autre";
  }
}

function personName(p?: { firstName: string; lastName: string } | null) {
  return p ? `${p.firstName} ${p.lastName}`.trim() : null;
}

type ListQuery = { q?: unknown; from?: unknown; to?: unknown; limit?: unknown };

/** GET / — liste des parcours facturés (une ligne = une facture unique). */
router.get("/", async (req, res) => {
  return res.json(await listJourneyInvoices(req.query as ListQuery));
});

export async function listJourneyInvoices(query: ListQuery) {
  const q = String(query.q ?? "").trim();
  const fromRaw = String(query.from ?? "").trim();
  const toRaw = String(query.to ?? "").trim();
  const take = Math.min(500, Math.max(1, Number(query.limit) || 200));

  const createdAt: Prisma.DateTimeFilter = {};
  if (fromRaw) {
    const d = new Date(fromRaw);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      createdAt.gte = d;
    }
  }
  if (toRaw) {
    const d = new Date(toRaw);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAt.lte = d;
    }
  }

  const patientFilter: Prisma.PatientWhereInput | undefined = q
    ? {
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      }
    : undefined;

  const visits = await prisma.visit.findMany({
    where: {
      invoices: { some: ACTIVE_INVOICE },
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(patientFilter ? { patient: patientFilter } : {}),
    },
    select: {
      id: true,
      patientId: true,
      createdAt: true,
      patient: { select: { code: true, firstName: true, lastName: true, phone: true } },
      assignedDoctor: { select: { firstName: true, lastName: true } },
      invoices: {
        where: ACTIVE_INVOICE,
        select: { type: true, amountFcfa: true, paidAmountFcfa: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  const orphans = await loadOrphanInvoicesByVisit(visits);

  return visits.map((visit) => {
    const invoices = [...visit.invoices, ...(orphans.get(visit.id) ?? [])];
    const totals = invoiceTotals(invoices);
    return {
      visitId: visit.id,
      reference: `PRC-${visit.id.slice(-8).toUpperCase()}`,
      date: visit.createdAt,
      patient: visit.patient,
      doctor: personName(visit.assignedDoctor),
      sections: [...new Set(invoices.map((i) => sectionOf(i.type)))],
      invoiceCount: invoices.length,
      ...totals,
    };
  });
}

type DetailLine = {
  label: string;
  detail?: string | null;
  quantity: number;
  unitPriceFcfa: number;
  amountFcfa: number;
};

type DetailSection = {
  key: string;
  title: string;
  invoiceNumbers: string[];
  lines: DetailLine[];
  grossFcfa: number;
  reductionFcfa: number;
  netFcfa: number;
  paidFcfa: number;
};

/** GET /:visitId — facture unique détaillée d'un parcours. */
router.get("/:visitId", async (req, res) => {
  const result = await getJourneyInvoice(String(req.params.visitId ?? "").trim());
  if ("error" in result) return res.status(404).json(result);
  return res.json(result);
});

export async function getJourneyInvoice(visitId: string) {
  await refreshExamPriceCache();
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      patient: true,
      assignedDoctor: { select: { firstName: true, lastName: true } },
      assignedClinicService: { select: { name: true } },
      consultation: {
        select: {
          clinicalNotes: true,
          diagnosis: true,
          doctor: { select: { firstName: true, lastName: true } },
        },
      },
      surgeryCase: {
        select: {
          totalCostFcfa: true,
          interventionType: { select: { label: true } },
          surgeon: { select: { firstName: true, lastName: true } },
        },
      },
      hospitalization: {
        select: {
          roomType: true,
          dailyRateFcfa: true,
          nightsCount: true,
          reductionFcfa: true,
          totalDueFcfa: true,
          depositFcfa: true,
          startDate: true,
          endDate: true,
          room: { select: { name: true } },
        },
      },
      invoices: { where: ACTIVE_INVOICE, include: invoiceInclude, orderBy: { createdAt: "asc" } },
    },
  });
  if (!visit) return { error: "Parcours introuvable" } as const;

  const orphans = await loadOrphanInvoicesByVisit([visit]);
  const invoices: InvoiceRow[] = [...visit.invoices, ...(orphans.get(visit.id) ?? [])];
  if (!invoices.length) return { error: "Aucune facture pour ce parcours" } as const;

  const notes = visit.consultation?.clinicalNotes ?? null;
  const sheets = new Map(buildExamSheetsByKind(notes).map((s) => [s.kind, s]));

  const sections = new Map<string, DetailSection>();
  const SECTION_TITLES: Record<string, string> = {
    consultation: "Consultation",
    examens: "Examens",
    operation: "Opération",
    hospitalisation: "Hospitalisation",
    pharmacie: "Pharmacie",
    autre: "Autres",
  };

  const section = (key: string, title?: string) => {
    let s = sections.get(key);
    if (!s) {
      s = {
        key,
        title: title ?? SECTION_TITLES[key] ?? key,
        invoiceNumbers: [],
        lines: [],
        grossFcfa: 0,
        reductionFcfa: 0,
        netFcfa: 0,
        paidFcfa: 0,
      };
      sections.set(key, s);
    }
    return s;
  };

  /** Ajoute les lignes d'une facture, avec une réduction si le brut dépasse le net. */
  const addInvoice = (s: DetailSection, invoice: InvoiceRow, lines: DetailLine[]) => {
    const net = Math.max(0, invoice.amountFcfa);
    let gross = lines.reduce((sum, l) => sum + l.amountFcfa, 0);
    if (!lines.length || gross < net) {
      // Lignes incomplètes : on complète pour que le détail colle au montant facturé.
      const missing = net - gross;
      lines.push({
        label: lines.length ? "Complément facturé" : SECTION_TITLES[sectionOf(invoice.type)] ?? "Prestation",
        quantity: 1,
        unitPriceFcfa: missing,
        amountFcfa: missing,
      });
      gross = net;
    }
    s.invoiceNumbers.push(invoice.invoiceNumber);
    s.lines.push(...lines);
    s.grossFcfa += gross;
    s.reductionFcfa += gross - net;
    s.netFcfa += net;
    s.paidFcfa += Math.max(0, Math.min(invoice.paidAmountFcfa, invoice.amountFcfa));
  };

  for (const invoice of invoices) {
    switch (invoice.type) {
      case InvoiceType.CONSULTATION: {
        const sessions = visit.sessionsCount ?? 0;
        const sessionPrice = visit.sessionPriceFcfa ?? 0;
        const fee = visit.consultationFeeFcfa ?? invoice.amountFcfa;
        const line: DetailLine =
          sessions > 0 && sessionPrice > 0
            ? {
                label: "Séances de kinésithérapie",
                quantity: sessions,
                unitPriceFcfa: sessionPrice,
                amountFcfa: sessions * sessionPrice,
              }
            : {
                label: "Consultation",
                detail: visit.assignedClinicService?.name ?? visit.patient.service ?? null,
                quantity: 1,
                unitPriceFcfa: fee,
                amountFcfa: fee,
              };
        addInvoice(section("consultation"), invoice, [line]);
        break;
      }
      case InvoiceType.LAB_EXAM: {
        const kind = (invoice.billingExamKind ?? null) as ExamKindSlug | null;
        const title = kind ? EXAM_KIND_SECTION_LABELS[kind] ?? "Examens" : "Examens";
        const s = section(`examens:${kind ?? "autre"}`, title);
        let labels: string[] = [];
        if (kind) {
          labels = paidExamLabels(notes, kind);
          if (!labels.length) labels = (sheets.get(kind)?.lines ?? []).map((l) => l.label);
        }
        // Libellés déjà détaillés sur une autre facture du même type : ne pas les répéter.
        const already = new Set(s.lines.map((l) => l.label));
        const lines = labels
          .filter((label) => !already.has(label))
          .map((label) => {
            const price = getLabExamPriceFcfa(label);
            return { label, quantity: 1, unitPriceFcfa: price, amountFcfa: price };
          });
        addInvoice(s, invoice, lines);
        break;
      }
      case InvoiceType.SURGERY: {
        const sc = visit.surgeryCase;
        const total = sc?.totalCostFcfa ?? invoice.amountFcfa;
        addInvoice(section("operation"), invoice, [
          {
            label: sc?.interventionType?.label ?? "Opération",
            detail: sc?.surgeon ? `Chirurgien : ${personName(sc.surgeon)}` : null,
            quantity: 1,
            unitPriceFcfa: total,
            amountFcfa: total,
          },
        ]);
        break;
      }
      case InvoiceType.HOSPITALIZATION_DEPOSIT:
      case InvoiceType.HOSPITALIZATION_FINAL: {
        const h = visit.hospitalization;
        const isFinal = invoice.type === InvoiceType.HOSPITALIZATION_FINAL;
        const room = h?.room?.name ? `Chambre ${h.room.name}` : null;
        const line: DetailLine =
          isFinal && h && h.nightsCount > 0 && h.dailyRateFcfa > 0
            ? {
                label: "Séjour d'hospitalisation",
                detail: [room, `${h.nightsCount} nuit(s)`].filter(Boolean).join(" · "),
                quantity: h.nightsCount,
                unitPriceFcfa: h.dailyRateFcfa,
                amountFcfa: invoice.amountFcfa,
              }
            : {
                label: isFinal ? "Solde d'hospitalisation" : "Caution d'hospitalisation",
                detail: room,
                quantity: 1,
                unitPriceFcfa: invoice.amountFcfa,
                amountFcfa: invoice.amountFcfa,
              };
        addInvoice(section("hospitalisation"), invoice, [line]);
        break;
      }
      case InvoiceType.PHARMACY: {
        const lines = invoice.pharmacyLines.map((l) => ({
          label: l.product?.name ?? "Produit",
          quantity: l.quantity,
          unitPriceFcfa: l.unitPriceFcfa,
          amountFcfa: l.lineTotalFcfa,
        }));
        addInvoice(section("pharmacie"), invoice, lines);
        break;
      }
      default:
        addInvoice(section("autre"), invoice, []);
    }
  }

  const orderedSections = [...sections.values()].sort((a, b) => {
    const order = ["consultation", "examens", "operation", "hospitalisation", "pharmacie", "autre"];
    return order.indexOf(a.key.split(":")[0]) - order.indexOf(b.key.split(":")[0]);
  });

  const grossFcfa = orderedSections.reduce((s, x) => s + x.grossFcfa, 0);
  const reductionFcfa = orderedSections.reduce((s, x) => s + x.reductionFcfa, 0);
  const totals = invoiceTotals(invoices);
  const cashiers = [...new Set(invoices.map((i) => personName(i.issuedBy)).filter(Boolean))];

  return {
    visitId: visit.id,
    reference: `PRC-${visit.id.slice(-8).toUpperCase()}`,
    date: visit.createdAt,
    lastInvoiceAt: invoices.reduce((d, i) => (i.createdAt > d ? i.createdAt : d), invoices[0].createdAt),
    patient: {
      code: visit.patient.code,
      firstName: visit.patient.firstName,
      lastName: visit.patient.lastName,
      phone: visit.patient.phone,
      gender: visit.patient.gender,
      age: visit.patient.age,
      ageUnit: visit.patient.ageUnit,
      address: visit.patient.address,
      category: visit.patient.category,
    },
    doctor: personName(visit.consultation?.doctor ?? visit.assignedDoctor),
    service: visit.assignedClinicService?.name ?? visit.patient.service ?? null,
    cashiers,
    sections: orderedSections,
    grossFcfa,
    reductionFcfa,
    ...totals,
  };
}

export default router;
