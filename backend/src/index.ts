import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import patientsRoutes from "./routes/patients.js";
import visitsRoutes from "./routes/visits.js";
import consultationsRoutes from "./routes/consultations.js";
import comptabiliteRoutes from "./routes/comptabilite.js";
import blocSallesRoutes from "./routes/bloc-salles.js";
import pharmacieRoutes from "./routes/pharmacie.js";
import facturesRoutes from "./routes/factures.js";
import adminRoutes from "./routes/admin.js";
import dashboardRoutes from "./routes/dashboard.js";
import hospitalisationRoutes from "./routes/hospitalisation.js";
import { refreshExamPriceCache } from "./lib/lab-exam-prices.js";
import { backfillLegacyConsultationInvoices } from "./lib/revenue-stats.js";
import { backfillLabReceptionistApprovals } from "./lib/lab-receptionist-backfill.js";
import examCatalogRoutes from "./routes/exam-catalog.js";
import examTypesRoutes from "./routes/exam-types.js";
import medecinExamCatalogRoutes from "./routes/medecin-exam-catalog.js";
import medecinOperationTypesRoutes from "./routes/medecin-operation-types.js";
import patientDossiersRoutes, { initPatientDossiers } from "./routes/patient-dossiers.js";
import laboratoireRoutes from "./routes/laboratoire.js";
import labPanelsRoutes from "./routes/lab-panels.js";
import { seedLabPanelsIfEmpty } from "./lib/lab-panels-seed.js";
import { refreshLabPanelRegistry } from "./lib/lab-panels-registry.js";
import { syncAllExamLabPanelLinks } from "./lib/exam-lab-panel.js";
import surgeriesRoutes from "./routes/surgeries.js";
import cashSettlementsRoutes from "./routes/cash-settlements.js";
import cashDeskRoutes from "./routes/cash-desk.js";
import gestionnaireRoutes from "./routes/gestionnaire.js";
import logistiqueRoutes from "./routes/logistique.js";
import labStockRoutes from "./routes/lab-stock.js";
import clientSetupRoutes from "./routes/client-setup.js";
import doctorOvertimeRoutes from "./routes/doctor-overtime.js";
import doctorSharesRoutes from "./routes/doctor-shares.js";
import clinicInfoRoutes from "./routes/clinic-info.js";
import { ensureClinicInfoRow } from "./lib/clinic.js";
import { getLanIpv4, getTailscaleIpv4, isPrivateLanOrigin, parseCorsOrigins } from "./lib/lan-host.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** backend/src ou backend/dist → racine projet = ../.. */
const projectRoot = path.resolve(__dirname, "../..");
const frontendDist =
  process.env.FRONTEND_DIST?.trim() ||
  path.join(projectRoot, "frontend", "dist");
const frontendIndex = path.join(frontendDist, "index.html");

/** Cache long pour les assets hashés Vite ; no-cache pour HTML / SW (mises à jour). */
function setFrontendCacheHeaders(res: express.Response, filePath: string) {
  const base = path.basename(filePath).toLowerCase();
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (
    base === "index.html" ||
    base === "sw.js" ||
    base.startsWith("workbox-") ||
    base.endsWith(".webmanifest")
  ) {
    res.setHeader("Cache-Control", "no-cache");
    return;
  }
  if (normalized.includes("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
}

const corsAllowList = parseCorsOrigins(process.env.CORS_ORIGIN);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsAllowList.includes(origin)) return callback(null, true);
      if (isPrivateLanOrigin(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "alwatan-api" });
});

app.get("/api/app-version", (_req, res) => {
  try {
    if (!fs.existsSync(frontendIndex)) {
      res.json({ buildId: "dev", updatedAt: null });
      return;
    }
    const html = fs.readFileSync(frontendIndex, "utf8");
    const match = html.match(/assets\/index-[^"']+\.js/);
    const stat = fs.statSync(frontendIndex);
    const buildId = match?.[0] ?? `mtime-${stat.mtimeMs}`;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      buildId,
      updatedAt: stat.mtime.toISOString(),
    });
  } catch {
    res.json({ buildId: "unknown", updatedAt: null });
  }
});

app.get("/api/health/frontend", (_req, res) => {
  const ready = fs.existsSync(frontendIndex);
  res.status(ready ? 200 : 503).json({
    ready,
    frontendDist,
    indexHtml: frontendIndex,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/patients", patientsRoutes);
app.use("/api/visits", visitsRoutes);
app.use("/api/consultations", consultationsRoutes);
app.use("/api/comptabilite", comptabiliteRoutes);
app.use("/api/bloc-salles", blocSallesRoutes);
app.use("/api/pharmacie", pharmacieRoutes);
app.use("/api/factures", facturesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/clinic-info", clinicInfoRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/hospitalisation", hospitalisationRoutes);
app.use("/api/exam-catalog", examCatalogRoutes);
app.use("/api/comptabilite/exam-types", examTypesRoutes);
app.use("/api/consultation/exam-nomenclature", medecinExamCatalogRoutes);
app.use("/api/consultation/operation-types", medecinOperationTypesRoutes);
app.use("/api/patient-dossiers", patientDossiersRoutes);
app.use("/api/laboratoire", laboratoireRoutes);
app.use("/api/lab-panels", labPanelsRoutes);
app.use("/api/surgeries", surgeriesRoutes);
app.use("/api/cash-settlements", cashSettlementsRoutes);
app.use("/api/cash-desk", cashDeskRoutes);
app.use("/api/gestionnaire", gestionnaireRoutes);
app.use("/api/logistique", logistiqueRoutes);
app.use("/api/lab-stock", labStockRoutes);
app.use("/api/client-setup", clientSetupRoutes);
app.use("/api/doctor-overtime", doctorOvertimeRoutes);
app.use("/api/doctor-shares", doctorSharesRoutes);

refreshExamPriceCache().catch((error) => {
  console.error("Impossible de charger le cache des tarifs examens:", error);
});

ensureClinicInfoRow().catch((error) => {
  console.error("Impossible d'initialiser les infos clinique:", error);
});

seedLabPanelsIfEmpty()
  .then((created) => {
    if (created > 0) {
      console.log(`${created} formulaire(s) de résultats laboratoire initialisé(s).`);
    }
    return refreshLabPanelRegistry();
  })
  .then(() => syncAllExamLabPanelLinks())
  .then((sync) => {
    if (sync.created > 0 || sync.linked > 0) {
      console.log(
        `Examens ↔ formulaires labo : ${sync.scanned} examen(s), ${sync.linked} lié(s), ${sync.created} formulaire(s) créé(s).`,
      );
    }
  })
  .catch((error) => {
    console.error("Impossible d'initialiser les formulaires laboratoire:", error);
  });

initPatientDossiers().catch((error) => {
  console.error("Impossible d'initialiser les dossiers patients:", error);
});

backfillLegacyConsultationInvoices()
  .then((count) => {
    if (count > 0) {
      console.log(`${count} facture(s) consultation historique(s) marquée(s) comme payée(s).`);
    }
  })
  .catch((error) => {
    console.error("Synchronisation factures consultation:", error);
  });

backfillLabReceptionistApprovals()
  .then((count) => {
    if (count > 0) {
      console.log(`${count} dossier(s) labo : réceptionniste rétabli pour « Prescrit par ».`);
    }
  })
  .catch((error) => {
    console.error("Synchronisation réceptionnistes labo:", error);
  });

/**
 * frontend/dist est ignoré par Git : après clone/pull/nettoyage il disparaît.
 * Sans index.html Express répondait « Cannot GET / ». On reconstruit puis,
 * si échec, on affiche une page d’aide claire (jamais le 404 Express brut).
 */
function tryBuildFrontend(): boolean {
  if (process.env.AUTO_BUILD_FRONTEND === "0") return false;
  const frontendRoot = path.join(projectRoot, "frontend");
  if (!fs.existsSync(path.join(frontendRoot, "package.json"))) return false;

  console.warn(
    "Interface absente (frontend/dist) — compilation automatique… (1–3 min)",
  );
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["run", "build"], {
    cwd: frontendRoot,
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  const ok = result.status === 0 && fs.existsSync(frontendIndex);
  if (!ok) {
    console.error(
      "Échec compilation frontend. Sur le serveur : scripts\\lancer-serveur.cmd (mode cabinet) ou cd frontend && npm run build",
    );
  }
  return ok;
}

function sendFrontendUnavailablePage(res: express.Response) {
  res
    .status(503)
    .type("html")
    .setHeader("Cache-Control", "no-store")
    .send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Alwatan — Interface indisponible</title>
  <style>
    body { font-family: Segoe UI, system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #1a2332; line-height: 1.5; }
    h1 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    code { background: #eef2f7; padding: 0.1em 0.35em; border-radius: 4px; }
    ol { padding-left: 1.25rem; }
    a { color: #0b5fff; }
  </style>
</head>
<body>
  <h1>L’application clinique n’est pas prête</h1>
  <p>Le serveur API répond, mais l’interface compilée (<code>frontend/dist</code>) est absente.</p>
  <p><strong>Sur le PC serveur</strong>, faites l’une de ces actions puis rechargez cette page :</p>
  <ol>
    <li>Double-cliquez <code>scripts\\lancer-serveur.cmd</code> (mode cabinet recommandé)</li>
    <li>Ou dans un terminal : <code>cd frontend</code> puis <code>npm run build</code>, ensuite redémarrez le backend</li>
  </ol>
  <p>Contrôle technique : <a href="/api/health/frontend">/api/health/frontend</a> doit afficher <code>"ready": true</code>.</p>
</body>
</html>`);
}

let serveFrontend =
  process.env.SERVE_FRONTEND !== "0" && fs.existsSync(frontendIndex);
if (!serveFrontend && process.env.SERVE_FRONTEND !== "0") {
  if (tryBuildFrontend()) {
    serveFrontend = true;
  }
}

if (serveFrontend) {
  app.use(
    express.static(frontendDist, {
      index: false,
      fallthrough: true,
      etag: true,
      lastModified: true,
      setHeaders: setFrontendCacheHeaders,
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(frontendIndex, (error) => {
      if (error) next(error);
    });
  });
  console.log(`Interface servie depuis ${frontendDist}`);
} else {
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    sendFrontendUnavailablePage(res);
  });
  console.warn(
    `Interface non servie (index introuvable ou SERVE_FRONTEND=0) : ${frontendIndex}`,
  );
}

function startServer() {
  const keyPath = process.env.SSL_KEY_PATH?.trim();
  const certPath = process.env.SSL_CERT_PATH?.trim();
  const useTls =
    keyPath &&
    certPath &&
    fs.existsSync(keyPath) &&
    fs.existsSync(certPath);

  const onListen = (scheme: "http" | "https") => {
    const label = host === "0.0.0.0" ? "localhost" : host;
    console.log(`API Al-Watan Manager sur ${scheme}://${label}:${port}`);
    if (serveFrontend) {
      console.log(`Application clinique : ${scheme}://localhost:${port}`);
    }
    const lanIp = getLanIpv4();
    const tsIp = getTailscaleIpv4();
    if (lanIp && host === "0.0.0.0") {
      console.log(`Accès Wi-Fi / Ethernet : ${scheme}://${lanIp}:${port}`);
      if (serveFrontend) {
        console.log(`  → interface + API sur le même port ${port}`);
      }
      console.log(`  → mode dev interface : ${scheme}://${lanIp}:5173 (si Vite est démarré)`);
    }
    if (tsIp && host === "0.0.0.0") {
      console.log(`Accès Tailscale        : ${scheme}://${tsIp}:${port}`);
    }
  };

  if (useTls) {
    const server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      app,
    );
    server.listen(port, host, () => onListen("https"));
    return;
  }

  if (keyPath || certPath) {
    console.warn(
      "SSL_KEY_PATH / SSL_CERT_PATH défini(s) mais fichier(s) introuvable(s) — démarrage en HTTP.",
    );
  }

  http.createServer(app).listen(port, host, () => onListen("http"));
}

startServer();
