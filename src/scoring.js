// Weighted DVF scoring — mirror of r-spike core/scoring.py.
//
// Scores are on the 1-3-9 (Low/Med/High) scale. TCO combines the complements of
// Viability and Feasibility (9->1, 3->3, 1->9); Weighted DVF = Desirability / TCO.
// bucket() snaps any value to the nearest of {1,3,9}, so it's robust to legacy
// 0-10 scores too.

const BUCKETS = [1, 3, 9];

export function bucket(score) {
  if (score == null) return null;
  let best = BUCKETS[0], bd = Infinity;
  for (const b of BUCKETS) {
    const d = Math.abs(score - b);
    if (d < bd) { bd = d; best = b; }   // ties keep the smaller bucket
  }
  return best;
}

export function bucketLabel(b) {
  return b === 9 ? "High" : b === 3 ? "Med" : b === 1 ? "Low" : "—";
}

const COMP = { 9: 1, 3: 3, 1: 9 };
export function complement(b) { return COMP[b]; }

export function tco(v, f) {
  const bv = bucket(v), bf = bucket(f);
  if (bv == null || bf == null) return null;
  return complement(bv) + complement(bf);
}

export function weightedDVF(d, v, f) {
  const bd = bucket(d), t = tco(v, f);
  if (bd == null || !t) return null;
  return bd / t;
}

export function tier(score) {
  if (score == null) return { label: "Unscored", color: "#7a849e" };
  if (score >= 1.5) return { label: "Do first", color: "#37c98b" };
  if (score >= 0.75) return { label: "Strong", color: "#FE5716" };
  if (score >= 0.30) return { label: "Consider", color: "#f5b301" };
  return { label: "Reconsider", color: "#e03030" };
}
