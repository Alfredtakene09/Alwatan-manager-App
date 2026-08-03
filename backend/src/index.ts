import "dotenv/config";
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
import examCatalogRoutes from "./routes/exam-catalog.js";
import examTypesRoutes from "./routes/exam-types.js";
import medecinExamCatalogRoutes from "./routes/medecin-exam-catalog.js";
import medecinOperationTypesRoutes from "./routes/medecin-operation-types.js";
import patientDossiersRoutes, { initPatientDossiers } from "./routes/patient-dossiers.js";
import laboratoireRoutes from "./routes/laboratoire.js";
import labPanelsRoutes from "./routes/lab-panels.js";
import { seedLabPanelsIfEmpty } from "./lib/lab-panels-seed.js";
import { refreshLabPanelRegistry } from "./lib/lab-panels-registry.js";
import surgeriesRoutes from "./routes/surgeries.js";
import cashSettlementsRoutes from "./routes/cash-settlements.js";
import cashDeskRoutes from "./routes/cash-desk.js";
import gestionnaireRoutes from "./routes/gestionnaire.js";
import logistiqueRoutes from "./routes/logistique.js";
import labStockRoutes from "./routes/lab-stock.js";
import clientSetupRoutes from "./routes/client-setup.js";
import doctorOvertimeRoutes from "./routes/doctor-overtime.js";
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

refreshExamPriceCache().catch((error) => {
  console.error("Impossible de charger le cache des tarifs examens:", error);
});

seedLabPanelsIfEmpty()
  .then((created) => {
    if (created > 0) {
      console.log(`${created} formulaire(s) de résultats laboratoire initialisé(s).`);
    }
    return refreshLabPanelRegistry();
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

const serveFrontend =
  process.env.SERVE_FRONTEND !== "0" && fs.existsSync(frontendIndex);
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
