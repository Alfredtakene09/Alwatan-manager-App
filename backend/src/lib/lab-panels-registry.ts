import { prisma } from "./db.js";
import { registerLabPanels } from "./lab-panel-results.js";

/** Recharge le registre slug/label depuis la base (à appeler au démarrage et après chaque mutation). */
export async function refreshLabPanelRegistry() {
  const panels = await prisma.labPanel.findMany({
    select: { slug: true, label: true },
    orderBy: { sortOrder: "asc" },
  });
  registerLabPanels(panels);
  return panels.length;
}
