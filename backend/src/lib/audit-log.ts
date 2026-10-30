import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { COOKIE_NAME, verifySessionToken } from "./auth.js";
import { runWithAppDataDeleteUnlock } from "./db-delete-guard.js";

/**
 * Journal d'audit : chaque action d'écriture (création, modification, suppression),
 * connexion et déconnexion est enregistrée dans AuditLog avec son auteur.
 * Les lectures (GET) ne sont pas journalisées pour ne pas saturer la base.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOGIN_PATH = "/api/auth/login";
const LOGOUT_PATH = "/api/auth/logout";

/** Champs jamais recopiés dans le journal (secrets, fichiers). */
const SECRET_KEY_PATTERN = /pass|token|secret|pin|otp|signature|base64|content|file|photo|image|data[_-]?url/i;
const MAX_STRING = 160;
const MAX_ARRAY = 15;
// 4 niveaux : facture → lignes → ligne → nouveau produit (nom, dosage).
const MAX_DEPTH = 4;
const MAX_BODY_CHARS = 3_000;

/** Libellés des modules, d'après le premier segment de l'URL /api/<module>/… */
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  auth: "Connexion / profil",
  patients: "Patients",
  visits: "Visites",
  consultations: "Consultations",
  consultation: "Consultation",
  comptabilite: "Comptabilité",
  "bloc-salles": "Bloc opératoire",
  pharmacie: "Pharmacie",
  factures: "Factures",
  admin: "Administration",
  "clinic-info": "Infos clinique",
  dashboard: "Tableau de bord",
  hospitalisation: "Hospitalisation",
  "exam-catalog": "Catalogue examens",
  "patient-dossiers": "Dossiers patients",
  laboratoire: "Laboratoire",
  "lab-panels": "Bilans laboratoire",
  surgeries: "Chirurgies",
  "cash-settlements": "Versements de caisse",
  "cash-desk": "Caisse",
  gestionnaire: "Gestionnaire",
  logistique: "Logistique",
  "lab-stock": "Stock laboratoire",
  "client-setup": "Configuration",
  "doctor-overtime": "Gardes médecins",
  "doctor-shares": "Parts médecins",
};

const ACTION_BY_METHOD: Record<string, string> = {
  POST: "CREATE",
  PUT: "UPDATE",
  PATCH: "UPDATE",
  DELETE: "DELETE",
};

const ID_SEGMENT = /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,}|\d+)$/i;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`… ${value.length - MAX_ARRAY} de plus`);
    return items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "***" : sanitizeValue(inner, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Copie lisible et sans secret du corps de la requête (null si vide ou trop gros). */
export function sanitizeAuditBody(body: unknown): unknown {
  if (body == null || typeof body !== "object") return null;
  if (!Array.isArray(body) && !Object.keys(body).length) return null;
  const clean = sanitizeValue(body, 0);
  const json = JSON.stringify(clean);
  if (json.length > MAX_BODY_CHARS) return { _note: "Contenu trop volumineux — non conservé" };
  return clean;
}

/** Module (entity) et identifiant visé déduits de l'URL. */
export function describeAuditPath(path: string): { entity: string; entityId: string | null } {
  const segments = path.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const entity = segments[0] ?? "api";
  const entityId = [...segments].reverse().find((segment) => ID_SEGMENT.test(segment)) ?? null;
  return { entity, entityId };
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]) || req.socket.remoteAddress;
  return raw ? raw.replace(/^::ffff:/, "") : null;
}

async function resolveLoginUser(identifier: unknown) {
  if (typeof identifier !== "string" || !identifier.trim()) return null;
  const login = identifier.trim();
  return prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: login, mode: "insensitive" } },
        { email: { equals: login, mode: "insensitive" } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, role: true },
  });
}

async function resolveLogoutUser(req: Request) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const session = await verifySessionToken(token);
    return prisma.user.findUnique({
      where: { id: session.id },
      select: { id: true, firstName: true, lastName: true, role: true },
    });
  } catch {
    return null;
  }
}

type AuditActor = { id: string; firstName: string; lastName: string; role: string } | null;

async function writeHttpAudit(req: Request, res: Response, startedAt: number, preResolved: AuditActor) {
  const path = req.originalUrl.split("?")[0];
  const isLogin = path === LOGIN_PATH;
  const isLogout = path === LOGOUT_PATH;
  const success = res.statusCode < 400;

  let actor: AuditActor = preResolved;
  if (!actor && req.user) {
    actor = {
      id: req.user.id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      role: req.user.role,
    };
  }
  if (!actor && isLogin) actor = await resolveLoginUser(req.body?.username);

  const { entity, entityId } = describeAuditPath(path);
  const action = isLogin
    ? success ? "LOGIN" : "LOGIN_FAILED"
    : isLogout
      ? "LOGOUT"
      : ACTION_BY_METHOD[req.method] ?? req.method;

  const metadata = {
    source: "http",
    method: req.method,
    path,
    status: res.statusCode,
    success,
    durationMs: Date.now() - startedAt,
    ip: clientIp(req),
    userName: actor ? `${actor.firstName} ${actor.lastName}`.trim() : null,
    userRole: actor?.role ?? null,
    ...(isLogin ? { login: typeof req.body?.username === "string" ? req.body.username.trim() : null } : {}),
    ...(isLogin || isLogout ? {} : { body: sanitizeAuditBody(req.body) }),
  };

  await prisma.auditLog.create({
    data: {
      userId: actor?.id ?? null,
      action,
      entity,
      entityId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

/** Middleware Express : journalise chaque requête d'écriture une fois la réponse envoyée. */
export function auditTrailMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!WRITE_METHODS.has(req.method) || !req.originalUrl.startsWith("/api/")) {
    next();
    return;
  }
  const startedAt = Date.now();
  const path = req.originalUrl.split("?")[0];
  // La déconnexion efface la session : on identifie l'utilisateur avant.
  const actorPromise: Promise<AuditActor> =
    path === LOGOUT_PATH ? resolveLogoutUser(req) : Promise.resolve(null);

  res.on("finish", () => {
    void actorPromise
      .then((actor) => writeHttpAudit(req, res, startedAt, actor))
      .catch((error) => console.error("[audit] écriture impossible:", error));
  });

  if (path === LOGOUT_PATH) {
    void actorPromise.finally(() => next());
    return;
  }
  next();
}

/* ------------------------------------------------------------------ */
/* Purge automatique                                                   */
/* ------------------------------------------------------------------ */

export const AUDIT_RETENTION_MONTHS = 2;
const PURGE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
let purgeTimer: ReturnType<typeof setInterval> | null = null;

export function auditRetentionCutoff(now = new Date(), months = AUDIT_RETENTION_MONTHS): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

/** Supprime les entrées du journal plus anciennes que la durée de conservation. */
export async function purgeOldAuditLogs(now = new Date()): Promise<number> {
  const cutoff = auditRetentionCutoff(now);
  // `await` dans le callback : la requête Prisma (paresseuse) doit s'exécuter dans le contexte déverrouillé.
  const result = await runWithAppDataDeleteUnlock("script", async () =>
    await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  );
  if (result.count) {
    console.log(
      `[audit] purge : ${result.count} entrée(s) antérieure(s) au ${cutoff.toLocaleDateString("fr-FR")} supprimée(s)`,
    );
  }
  return result.count;
}

/** Purge au démarrage puis toutes les 12 h : le journal ne garde que les 2 derniers mois. */
export function startAuditLogPurgeScheduler(): void {
  if (purgeTimer) return;
  const run = () => void purgeOldAuditLogs().catch((error) => console.error("[audit] purge impossible:", error));
  run();
  purgeTimer = setInterval(run, PURGE_CHECK_INTERVAL_MS);
  if (typeof purgeTimer.unref === "function") purgeTimer.unref();
  console.log(`[audit] journal conservé ${AUDIT_RETENTION_MONTHS} mois — purge automatique active`);
}
