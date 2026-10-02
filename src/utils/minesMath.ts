// Combinations helper for exact fair multipliers
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  for (let i = 1; i <= k; i++) {
    c = (c * (n - (k - i))) / i;
  }
  return c;
}

// Calculate standard multiplier with 4% casino house edge
export function calculateMinesMultiplier(minesCount: number, openedCount: number): number {
  if (openedCount <= 0) return 1.0;
  const totalCells = 25;
  const safeCells = totalCells - minesCount;
  if (openedCount > safeCells) return 1.0;

  const houseEdge = 0.96; // 4% edge
  const prob = combinations(safeCells, openedCount) / combinations(totalCells, openedCount);
  const rawMult = (1 / prob) * houseEdge;
  return Math.max(1.01, Math.round(rawMult * 100) / 100);
}
