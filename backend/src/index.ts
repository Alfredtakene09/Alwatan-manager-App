import "dotenv/config";
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
import surgeriesRoutes from "./routes/surgeries.js";
import cashSettlementsRoutes from "./routes/cash-settlements.js";
import cashDeskRoutes from "./routes/cash-desk.js";
import gestionnaireRoutes from "./routes/gestionnaire.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),
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
app.use("/api/surgeries", surgeriesRoutes);
app.use("/api/cash-settlements", cashSettlementsRoutes);
app.use("/api/cash-desk", cashDeskRoutes);
app.use("/api/gestionnaire", gestionnaireRoutes);

refreshExamPriceCache().catch((error) => {
  console.error("Impossible de charger le cache des tarifs examens:", error);
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

app.listen(port, () => {
  console.log(`API Al-Watan Manager sur http://localhost:${port}`);
});
