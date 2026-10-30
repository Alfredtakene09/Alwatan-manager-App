import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import {
  TRASH_RETENTION_MONTHS,
  TrashRestoreError,
  getTrashBatch,
  listTrash,
  restoreTrashBatch,
} from "../lib/trash.js";

const router = Router();
router.use(requireAuth, requireAdmin);

function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

router.get("/", async (req, res) => {
  const from = parseDay(req.query.from);
  const to = parseDay(req.query.to);
  const toExclusive = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : undefined;
  const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const result = await listTrash({ from: from ?? undefined, toExclusive, page, pageSize });
  return res.json({ ...result, page, pageSize, retentionMonths: TRASH_RETENTION_MONTHS });
});

router.get("/:batchId", async (req, res) => {
  const batch = await getTrashBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ error: "Élément introuvable dans la corbeille." });
  return res.json(batch);
});

router.post("/:batchId/restore", async (req, res) => {
  try {
    const result = await restoreTrashBatch(req.params.batchId, req.user!.id);
    return res.json(result);
  } catch (error) {
    if (error instanceof TrashRestoreError) return res.status(409).json({ error: error.message });
    throw error;
  }
});

export default router;
