import type { SoldComps } from './ebay';

const EBAY_FEE_RATE  = 0.1325; // 13.25% final value fee
const EST_SHIPPING   = 8.00;   // conservative flat outbound shipping estimate

export interface ScoreResult {
  score: number;           // 1-100
  estimatedProfit: number;
  roi: number;             // as decimal, e.g. 0.45 = 45%
  netRevenue: number;      // after fees
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  reason: string;
}

export function scoreProduct(cost: number, comps: SoldComps, shipping: number = EST_SHIPPING): ScoreResult {
  if (!comps.found || comps.count === 0 || comps.median === 0) {
    return { score: 1, estimatedProfit: 0, roi: 0, netRevenue: 0, grade: 'F', reason: 'No eBay sold comps found' };
  }

  const netRevenue     = comps.median - (comps.median * EBAY_FEE_RATE) - shipping;
  const estimatedProfit = netRevenue - cost;
  const roi             = cost > 0 ? estimatedProfit / cost : 0;

  // Confidence multiplier based on sold volume (more sales = more reliable signal)
  const volumeMultiplier = Math.min(1, comps.count / 20); // full confidence at 20+ comps

  // Base score from ROI
  let baseScore: number;
  if      (roi >= 1.0)  baseScore = 90; // 100%+ ROI
  else if (roi >= 0.75) baseScore = 80;
  else if (roi >= 0.50) baseScore = 70;
  else if (roi >= 0.30) baseScore = 57;
  else if (roi >= 0.20) baseScore = 45;
  else if (roi >= 0.10) baseScore = 32;
  else if (roi >= 0.0)  baseScore = 18;
  else                  baseScore = 5;  // negative ROI

  // Blend with volume confidence: low comps pull score toward 35 (uncertain)
  const score = Math.round(baseScore * volumeMultiplier + 35 * (1 - volumeMultiplier));
  const clamped = Math.max(1, Math.min(100, score));

  // Grade
  const grade: ScoreResult['grade'] =
    clamped >= 85 ? 'S' :
    clamped >= 70 ? 'A' :
    clamped >= 55 ? 'B' :
    clamped >= 40 ? 'C' :
    clamped >= 25 ? 'D' : 'F';

  const reason =
    roi < 0 ? `Negative ROI — costs $${cost.toFixed(2)}, nets $${netRevenue.toFixed(2)} after fees` :
    comps.count < 5 ? `Only ${comps.count} comp${comps.count !== 1 ? 's' : ''} — low confidence` :
    `${(roi * 100).toFixed(0)}% ROI · ${comps.count} comps · ~${comps.avgSoldPerMonth}/mo`;

  return { score: clamped, estimatedProfit, roi, netRevenue, grade, reason };
}
