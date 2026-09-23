import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { UPLOADS_ROOT } from "./patient-dossier.js";

const execFileAsync = promisify(execFile);

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export type BackupCloudStatus = "pending" | "uploaded" | "skipped" | "failed";

export type BackupManifest = {
  id: string;
  createdAt: string;
  databaseFile: string;
  uploadsFile: string | null;
  sizeBytes: { database: number; uploads: number };
  /** File d’attente cloud — à consommer plus tard par un fournisseur (S3, Drive…). */
  cloudStatus: BackupCloudStatus;
  cloudUploadedAt: string | null;
  cloudProvider: string | null;
  cloudError: string | null;
};

export type BackupResult = {
  ok: boolean;
  manifest?: BackupManifest;
  error?: string;
};

type ParsedDatabaseUrl = {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
};

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw == null || raw === "") return defaultValue;
  return !["0", "false", "off", "no"].includes(raw);
}

function envInt(name: string, defaultValue: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

/** Racine dépôt (…/Alwatan-manager-App) depuis backend/src|dist/lib. */
export function getProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

export function getBackupRoot(projectRoot = getProjectRoot()): string {
  return process.env.BACKUP_DIR?.trim() || path.join(projectRoot, "backups");
}

function stampNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  const m = url.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) {
    throw new Error(
      "DATABASE_URL invalide. Format attendu : postgresql://user:pass@host:port/db",
    );
  }
  return {
    user: decodeURIComponent(m[1]!),
    password: decodeURIComponent(m[2]!),
    host: m[3]!,
    port: m[4]!,
    database: m[5]!,
  };
}

async function findPgDump(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === "win32" ? "where" : "which",
      ["pg_dump"],
      { windowsHide: true },
    );
    const first = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (first) return first;
  } catch {
    /* chercher dans les dossiers d’installation */
  }

  if (process.platform !== "win32") return null;

  const roots = [
    "C:\\Program Files\\PostgreSQL",
    "C:\\Program Files (x86)\\PostgreSQL",
  ];
  for (const root of roots) {
    if (!fsSync.existsSync(root)) continue;
    const found = await walkFind(root, "pg_dump.exe", 4);
    if (found) return found;
  }
  return null;
}

async function walkFind(
  dir: string,
  fileName: string,
  maxDepth: number,
): Promise<string | null> {
  if (maxDepth < 0) return null;
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name.toLowerCase() === fileName.toLowerCase()) {
      return full;
    }
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const found = await walkFind(path.join(dir, ent.name), fileName, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

function runPgDump(args: {
  pgDump: string;
  db: ParsedDatabaseUrl;
  outFile: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      args.pgDump,
      [
        "-h",
        args.db.host,
        "-p",
        args.db.port,
        "-U",
        args.db.user,
        "-d",
        args.db.database,
        "-F",
        "p",
        "--no-owner",
        "--no-acl",
        "-f",
        args.outFile,
      ],
      {
        env: { ...process.env, PGPASSWORD: args.db.password },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump a échoué (code ${code}): ${stderr.trim() || "sans détail"}`));
    });
  });
}

async function zipUploads(uploadsDir: string, zipPath: string): Promise<boolean> {
  if (!fsSync.existsSync(uploadsDir)) return false;
  const entries = await fs.readdir(uploadsDir);
  if (entries.length === 0) return false;

  await fs.mkdir(path.dirname(zipPath), { recursive: true });

  if (process.platform === "win32") {
    const ps = `
$ErrorActionPreference = 'Stop'
Compress-Archive -Path (Join-Path '${uploadsDir.replace(/'/g, "''")}' '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force
`;
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
    );
    return fsSync.existsSync(zipPath);
  }

  try {
    await execFileAsync("zip", ["-r", "-q", zipPath, "."], {
      cwd: uploadsDir,
      maxBuffer: 20 * 1024 * 1024,
    });
    return fsSync.existsSync(zipPath);
  } catch {
    console.warn("[backup] zip indisponible — pièces jointes non archivées");
    return false;
  }
}

async function pruneOld(dir: string, pattern: RegExp, keepDays: number): Promise<void> {
  if (!fsSync.existsSync(dir)) return;
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const files = await fs.readdir(dir);
  for (const name of files) {
    if (!pattern.test(name)) continue;
    const full = path.join(dir, name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs < cutoff) {
        await fs.unlink(full);
        console.log(`[backup] suppression ancienne : ${name}`);
      }
    } catch {
      /* ignore */
    }
  }
}

async function writeManifest(
  backupRoot: string,
  manifest: BackupManifest,
): Promise<string> {
  const dir = path.join(backupRoot, "manifests");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${manifest.id}.json`);
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return file;
}

async function appendFailureLog(projectRoot: string, message: string): Promise<void> {
  const logDir = path.join(projectRoot, "runtime", "logs");
  await fs.mkdir(logDir, { recursive: true });
  const line = `${new Date().toISOString().replace("T", " ").slice(0, 19)} ${message}\n`;
  await fs.appendFile(path.join(logDir, "backup-failures.log"), line, "utf8");
}

/**
 * Exécute une sauvegarde complète (SQL + uploads) et écrit un manifeste cloud-ready.
 */
export async function runDataBackup(options?: {
  projectRoot?: string;
  keepDays?: number;
}): Promise<BackupResult> {
  const projectRoot = options?.projectRoot ?? getProjectRoot();
  const keepDays = options?.keepDays ?? envInt("BACKUP_KEEP_DAYS", 7);
  const backupRoot = getBackupRoot(projectRoot);
  const postgresDir = path.join(backupRoot, "postgres");
  const uploadsBackupDir = path.join(backupRoot, "uploads");
  const id = `alwatan-${stampNow()}`;

  try {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL manquant");

    const db = parseDatabaseUrl(databaseUrl);
    const pgDump = await findPgDump();
    if (!pgDump) {
      throw new Error(
        "pg_dump introuvable. Installez les outils client PostgreSQL ou ajoutez-les au PATH.",
      );
    }

    await fs.mkdir(postgresDir, { recursive: true });
    const sqlName = `${id}.sql`;
    const sqlPath = path.join(postgresDir, sqlName);

    console.log(`[backup] dump PostgreSQL → ${sqlPath}`);
    await runPgDump({ pgDump, db, outFile: sqlPath });
    const sqlStat = await fs.stat(sqlPath);

    let uploadsRel: string | null = null;
    let uploadsBytes = 0;
    const uploadsZip = path.join(uploadsBackupDir, `uploads-${id.replace(/^alwatan-/, "")}.zip`);
    const uploadsAbs = path.resolve(UPLOADS_ROOT);
    const zipped = await zipUploads(uploadsAbs, uploadsZip);
    if (zipped) {
      const uz = await fs.stat(uploadsZip);
      uploadsBytes = uz.size;
      uploadsRel = path.relative(backupRoot, uploadsZip).replace(/\\/g, "/");
      console.log(`[backup] pièces jointes → ${uploadsZip}`);
    }

    const cloudEnabled = envFlag("BACKUP_CLOUD_ENABLED", false);
    const manifest: BackupManifest = {
      id,
      createdAt: new Date().toISOString(),
      databaseFile: path.relative(backupRoot, sqlPath).replace(/\\/g, "/"),
      uploadsFile: uploadsRel,
      sizeBytes: { database: sqlStat.size, uploads: uploadsBytes },
      cloudStatus: cloudEnabled ? "pending" : "skipped",
      cloudUploadedAt: null,
      cloudProvider: process.env.BACKUP_CLOUD_PROVIDER?.trim() || null,
      cloudError: null,
    };

    await writeManifest(backupRoot, manifest);
    await pruneOld(postgresDir, /^alwatan-.*\.sql$/i, keepDays);
    await pruneOld(uploadsBackupDir, /^uploads-.*\.zip$/i, keepDays);
    await pruneOld(path.join(backupRoot, "manifests"), /^alwatan-.*\.json$/i, keepDays);

    if (cloudEnabled) {
      // Point d’extension : n’échoue pas la sauvegarde locale si le cloud est indisponible.
      try {
        await uploadPendingBackupsToCloud({ backupRoot });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[backup] envoi cloud différé : ${msg}`);
      }
    }

    const mb = (sqlStat.size / (1024 * 1024)).toFixed(2);
    console.log(`[backup] OK — ${id} (${mb} Mo SQL)`);
    return { ok: true, manifest };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backup] échec : ${message}`);
    await appendFailureLog(projectRoot, message).catch(() => undefined);
    return { ok: false, error: message };
  }
}

/**
 * Hook cloud : lit les manifests `pending` et les enverra vers le fournisseur configuré.
 * Pour l’instant : no-op documenté — à brancher (S3, B2, Drive…) sans changer le planificateur.
 */
export async function uploadPendingBackupsToCloud(options?: {
  backupRoot?: string;
}): Promise<{ uploaded: number; remaining: number }> {
  const backupRoot = options?.backupRoot ?? getBackupRoot();
  const manifestsDir = path.join(backupRoot, "manifests");
  if (!fsSync.existsSync(manifestsDir)) return { uploaded: 0, remaining: 0 };

  const provider = process.env.BACKUP_CLOUD_PROVIDER?.trim();
  if (!provider) {
    console.log(
      "[backup] BACKUP_CLOUD_ENABLED=1 mais BACKUP_CLOUD_PROVIDER non défini — fichiers locaux prêts.",
    );
    return { uploaded: 0, remaining: 0 };
  }

  // Placeholder explicite pour l’intégration future.
  throw new Error(
    `Fournisseur cloud « ${provider} » non implémenté. Les manifests restent en statut pending dans ${manifestsDir}.`,
  );
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let backupInFlight: Promise<BackupResult> | null = null;

async function runExclusiveBackup(): Promise<BackupResult> {
  if (backupInFlight) {
    console.log("[backup] déjà en cours — exécution ignorée");
    return backupInFlight;
  }
  backupInFlight = runDataBackup().finally(() => {
    backupInFlight = null;
  });
  return backupInFlight;
}

/**
 * Démarre la sauvegarde automatique (défaut : toutes les 2 heures).
 * Désactiver avec BACKUP_ENABLED=0.
 */
export function startDataBackupScheduler(options?: {
  projectRoot?: string;
}): void {
  if (!envFlag("BACKUP_ENABLED", true)) {
    console.log("[backup] planificateur désactivé (BACKUP_ENABLED=0)");
    return;
  }
  if (schedulerTimer) return;

  const hours = envInt("BACKUP_INTERVAL_HOURS", 2);
  const intervalMs = hours * 60 * 60 * 1000;
  const runOnStart = envFlag("BACKUP_RUN_ON_START", true);

  console.log(
    `[backup] planificateur actif — toutes les ${hours} h → ${getBackupRoot(options?.projectRoot)}`,
  );

  if (runOnStart) {
    void runExclusiveBackup();
  }

  schedulerTimer = setInterval(() => {
    void runExclusiveBackup();
  }, intervalMs > 0 ? intervalMs : TWO_HOURS_MS);

  // Ne bloque pas l’arrêt du process Node.
  if (typeof schedulerTimer.unref === "function") {
    schedulerTimer.unref();
  }
}

export function stopDataBackupScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
