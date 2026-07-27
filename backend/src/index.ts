import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
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
import { getLanIpv4, isPrivateLanOrigin, parseCorsOrigins } from "./lib/lan-host.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist =
  process.env.FRONTEND_DIST?.trim() ||
  path.resolve(__dirname, "../../frontend/dist");

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
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "alwatan-api" });
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
app.use("/api/patient-dossiers", patientDossiersRoutes);
app.use("/api/laboratoire", laboratoireRoutes);
app.use("/api/lab-panels", labPanelsRoutes);
app.use("/api/surgeries", surgeriesRoutes);
app.use("/api/cash-settlements", cashSettlementsRoutes);
app.use("/api/cash-desk", cashDeskRoutes);
app.use("/api/gestionnaire", gestionnaireRoutes);
app.use("/api/logistique", logistiqueRoutes);

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

const serveFrontend = process.env.SERVE_FRONTEND !== "0" && fs.existsSync(frontendDist);
if (serveFrontend) {
  app.use(express.static(frontendDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"), (error) => {
      if (error) next(error);
    });
  });
  console.log(`Interface servie depuis ${frontendDist}`);
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
    if (lanIp && host === "0.0.0.0") {
      console.log(`Accès réseau (autres postes) : ${scheme}://${lanIp}:${port}`);
      if (serveFrontend) {
        console.log(`  → interface + API sur le même port ${port}`);
      }
      console.log(`  → mode dev interface : ${scheme}://${lanIp}:5173 (si Vite est démarré)`);
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
