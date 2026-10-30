import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { AUDIT_MODULE_LABELS, AUDIT_RETENTION_MONTHS } from "../lib/audit-log.js";
import {
  collectAuditIds,
  describeAuditAction,
  describeAuditResult,
  readableAuditDetails,
  resolveAuditNames,
} from "../lib/audit-describe.js";

const router = Router();
router.use(requireAuth, requireAdmin);

/** Libellés lisibles des actions (automatiques et métier déjà journalisées). */
const ACTION_LABELS: Record<string, string> = {
  CREATE: "Création",
  UPDATE: "Modification",
  DELETE: "Suppression",
  LOGIN: "Connexion",
  LOGIN_FAILED: "Connexion échouée",
  LOGOUT: "Déconnexion",
};

const ACTION_GROUPS: Record<string, string[]> = {
  CREATE: ["CREATE"],
  UPDATE: ["UPDATE"],
  DELETE: ["DELETE"],
  AUTH: ["LOGIN", "LOGIN_FAILED", "LOGOUT"],
};

function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function readMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

router.get("/", async (req, res) => {
  const from = parseDay(req.query.from);
  const toStart = parseDay(req.query.to);
  const createdAt: Prisma.DateTimeFilter = {};
  if (from) createdAt.gte = from;
  if (toStart) {
    const toExclusive = new Date(toStart);
    toExclusive.setDate(toExclusive.getDate() + 1);
    createdAt.lt = toExclusive;
  }
  const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : undefined;
  const actionGroup = typeof req.query.action === "string" ? ACTION_GROUPS[req.query.action] : undefined;
  const entity = typeof req.query.entity === "string" && req.query.entity ? req.query.entity : undefined;
  const pageSize = Math.min(500, Math.max(10, Number(req.query.pageSize) || 100));
  const page = Math.max(1, Number(req.query.page) || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(userId ? { userId } : {}),
    ...(actionGroup ? { action: { in: actionGroup } } : {}),
    ...(entity ? { entity } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { firstName: true, lastName: true, role: true, username: true } } },
    }),
  ]);

  // Noms des patients, produits, fournisseurs… cités dans la page, en une fois.
  const ids = new Set<string>();
  for (const row of rows) {
    const meta = readMetadata(row.metadata);
    collectAuditIds(meta.source === "http" ? meta.body : row.metadata, ids);
    if (row.entityId) collectAuditIds(row.entityId, ids);
  }
  const names = await resolveAuditNames(ids);

  const items = rows.map((row) => {
    const meta = readMetadata(row.metadata);
    const isHttp = meta.source === "http";
    const moduleLabel = AUDIT_MODULE_LABELS[row.entity] ?? row.entity;
    const method = isHttp && typeof meta.method === "string" ? meta.method : null;
    const path = isHttp && typeof meta.path === "string" ? meta.path : null;
    const status = isHttp && typeof meta.status === "number" ? meta.status : null;
    const success = isHttp ? meta.success !== false : true;
    const rawDetails = isHttp ? meta.body ?? null : row.metadata;
    const userName = row.user
      ? `${row.user.firstName} ${row.user.lastName}`.trim()
      : typeof meta.userName === "string" && meta.userName
        ? meta.userName
        : typeof meta.login === "string" && meta.login
          ? meta.login
          : "Système / inconnu";
    return {
      id: row.id,
      createdAt: row.createdAt,
      userId: row.userId,
      userName,
      userRole: row.user?.role ?? (typeof meta.userRole === "string" ? meta.userRole : null),
      username: row.user?.username ?? null,
      action: row.action,
      actionLabel: ACTION_LABELS[row.action] ?? row.action,
      entity: row.entity,
      moduleLabel,
      entityId: row.entityId,
      entityName: row.entityId ? names.get(row.entityId) ?? null : null,
      // Suppression : lot de la corbeille où l'élément peut être consulté et restauré.
      trashBatchId: isHttp && typeof meta.trashBatchId === "string" ? meta.trashBatchId : null,
      method,
      path,
      status,
      success,
      ip: isHttp ? meta.ip ?? null : null,
      durationMs: isHttp ? meta.durationMs ?? null : null,
      // En clair pour l'utilisateur : ce qui a été fait, le résultat et les informations saisies.
      summary: describeAuditAction({ method, path, action: row.action, entity: row.entity, moduleLabel }),
      resultLabel: describeAuditResult(status, success),
      readable: readableAuditDetails(rawDetails, names),
      // Détails techniques : corps de requête nettoyé (HTTP) ou métadonnées métier d'origine.
      details: rawDetails,
    };
  });

  return res.json({
    items,
    total,
    page,
    pageSize,
    retentionMonths: AUDIT_RETENTION_MONTHS,
    modules: Object.entries(AUDIT_MODULE_LABELS).map(([id, label]) => ({ id, label })),
  });
});

export default router;
