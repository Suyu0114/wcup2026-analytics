// Most-likely scorelines from the stored model lambdas — a small port of
// engine/dixon_coles.py score_matrix/tau (display-only, like lib/value.ts is a
// port of engine/value.py). Parity is pinned by scoreline_vectors.json, generated
// from the actual engine (web/tests/fixtures/gen_scorelines.py); regenerate when
// the engine's RHO/MAXG change (constants.ts mirrors).
import { DC_RHO, SCORE_MATRIX_MAXG } from './constants';

export interface Scoreline {
  home: number;
  away: number;
  p: number;
}

function poissonPmf(k: number, lambda: number): number {
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Dixon–Coles low-score dependency correction (engine/dixon_coles.py tau). */
function tau(i: number, j: number, lh: number, la: number, rho: number): number {
  if (i === 0 && j === 0) return 1.0 - lh * la * rho;
  if (i === 0 && j === 1) return 1.0 + lh * rho;
  if (i === 1 && j === 0) return 1.0 + la * rho;
  if (i === 1 && j === 1) return 1.0 - rho;
  return 1.0;
}

/** Top-k most likely scorelines from the normalized DC score matrix. */
export function topScorelines(
  lambdaHome: number,
  lambdaAway: number,
  k = 2,
  rho: number = DC_RHO,
  maxg: number = SCORE_MATRIX_MAXG,
): Scoreline[] {
  const cells: Scoreline[] = [];
  let sum = 0;
  for (let i = 0; i <= maxg; i++) {
    for (let j = 0; j <= maxg; j++) {
      const p = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway) * tau(i, j, lambdaHome, lambdaAway, rho);
      cells.push({ home: i, away: j, p });
      sum += p;
    }
  }
  for (const c of cells) c.p /= sum;
  // stable order for ties: higher p first, then lower total goals, then home goals
  cells.sort((a, b) => b.p - a.p || a.home + a.away - (b.home + b.away) || a.home - b.home);
  return cells.slice(0, k);
}
