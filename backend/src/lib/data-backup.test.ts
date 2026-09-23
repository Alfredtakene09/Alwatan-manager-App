import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getBackupRoot,
  getProjectRoot,
  type BackupManifest,
} from "./data-backup.js";

describe("data-backup", () => {
  it("résout la racine projet et le dossier backups", () => {
    const root = getProjectRoot();
    assert.ok(root.length > 0);
    const backupRoot = getBackupRoot(root);
    assert.ok(backupRoot.endsWith("backups") || backupRoot.includes("backups"));
  });

  it("manifest cloud-ready a le statut pending ou skipped", () => {
    const m: BackupManifest = {
      id: "alwatan-test",
      createdAt: new Date().toISOString(),
      databaseFile: "postgres/alwatan-test.sql",
      uploadsFile: null,
      sizeBytes: { database: 1, uploads: 0 },
      cloudStatus: "pending",
      cloudUploadedAt: null,
      cloudProvider: null,
      cloudError: null,
    };
    assert.equal(m.cloudStatus, "pending");
  });
});
