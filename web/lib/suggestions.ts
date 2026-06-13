// Featured-card risk tiers — derived from MARKET de-vig probabilities only
// (never the model; no market → no tiers, same spirit as "no Pinnacle → no EV").
// These are probability-based risk labels, NOT value/EV claims: a high-probability
// selection is not a good bet unless the price is right (that's the EV calculator's
// job). The card copy must say so (featured.riskDisclaimer).

interface Triple {
  home: number;
  draw: number;
  away: number;
}

interface Totals {
  point: number;
  over: number;
  under: number;
}

export type SelectionKind = 'dc_home' | 'dc_away' | 'home' | 'away' | 'over' | 'under';

export interface Selection {
  kind: SelectionKind;
  p: number;
  point?: number;
}

export interface RiskTiers {
  steady: Selection; // favourite double-chance (win or draw)
  medium: Selection; // favourite straight win
  risky: Selection; // underdog straight win
  totals: Selection | null; // favoured side of the Pinnacle main line
}

export function computeRiskTiers(novig: Triple | null, totals: Totals | null): RiskTiers | null {
  if (novig === null) return null;
  const homeFav = novig.home >= novig.away;
  const tiers: RiskTiers = homeFav
    ? {
        steady: { kind: 'dc_home', p: novig.home + novig.draw },
        medium: { kind: 'home', p: novig.home },
        risky: { kind: 'away', p: novig.away },
        totals: null,
      }
    : {
        steady: { kind: 'dc_away', p: novig.away + novig.draw },
        medium: { kind: 'away', p: novig.away },
        risky: { kind: 'home', p: novig.home },
        totals: null,
      };
  if (totals !== null) {
    tiers.totals =
      totals.over >= totals.under
        ? { kind: 'over', p: totals.over, point: totals.point }
        : { kind: 'under', p: totals.under, point: totals.point };
  }
  return tiers;
}
