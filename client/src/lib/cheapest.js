// Derivation shared by the Home wall and the Cheapest page, so both name the
// same winner for every produce group.
//
// sets: [{ retailer, runId, capturedAt, selectionRule, rows: [...] }] from
// /api/cheapest — per retailer, the crawler's cheapest line per subcategory
// from its newest complete run.
//
// One winner per canonical produce group across retailers, cheapest unit price
// first, where both retailers price on the same basis (kg beats ea when mixed).
// A group usually has several lines per store (several subcategories, kg and
// each), so `byStore[group][retailer]` is each store's own best line by the
// same rule — the runner-up the Cheapest page shows beside the winner.
const beats = (r, cur) => !cur || (r.unitBasis === cur.unitBasis && r.unitPrice < cur.unitPrice) || (r.unitBasis === "kg" && cur.unitBasis !== "kg");

export function buildWall(sets) {
  const byGroup = {};
  const byStore = {};
  for (const s of sets) {
    for (const r of s.rows) {
      if (r.groupKind !== "produce" || !r.canonicalGroup || r.unitPrice == null) continue;
      if (beats(r, byGroup[r.canonicalGroup])) byGroup[r.canonicalGroup] = r;
      const st = (byStore[r.canonicalGroup] ||= {});
      if (beats(r, st[r.retailer])) st[r.retailer] = r;
    }
  }
  const groups = Object.values(byGroup).sort((a, b) => b.candidates - a.candidates);
  return {
    byGroup, groups, byStore,
    capturedAt: sets.map((s) => s.capturedAt).sort().pop() || null,
    selectionRule: sets[0]?.selectionRule,
    retailers: sets.map((s) => s.retailer),
  };
}

// "sweet-potatoes" -> "sweet potatoes"
export const groupLabel = (g) => g.replace(/[_-]/g, " ");
