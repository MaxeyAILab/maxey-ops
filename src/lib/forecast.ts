export type CostState = "ok" | "early" | "final" | "no-cost" | "no-progress";

export interface Forecast {
  costState: CostState;
  forecastCost: number | null;
  forecastProfit: number | null;
  forecastMarginPct: number | null;
}

/**
 * Forecast final cost = cost to date ÷ verified progress. It is only produced
 * once both costs and progress exist — absent data is "no-cost"/"no-progress"
 * with null figures, never a zero cost and never a 100% margin. Under 10%
 * complete the extrapolation is too volatile, so it is flagged "early".
 */
export function computeForecast(input: {
  contract: number;
  committed: number;
  pct: number; // verified progress, 0–100
  isCompleted: boolean;
}): Forecast {
  const { contract, committed, pct, isCompleted } = input;
  let costState: CostState;
  let forecastCost: number | null = null;
  if (isCompleted) {
    costState = committed > 0 ? "final" : "no-cost";
    forecastCost = committed > 0 ? committed : null;
  } else if (pct <= 0) {
    costState = "no-progress";
  } else if (committed <= 0) {
    costState = "no-cost";
  } else {
    forecastCost = pct >= 100 ? committed : committed / (pct / 100);
    costState = pct < 10 ? "early" : "ok";
  }
  const forecastProfit = forecastCost != null ? contract - forecastCost : null;
  const forecastMarginPct = forecastProfit != null && contract > 0 ? (forecastProfit / contract) * 100 : null;
  return { costState, forecastCost, forecastProfit, forecastMarginPct };
}
