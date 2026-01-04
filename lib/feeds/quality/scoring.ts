// lib/feeds/quality/scoring.ts

export type DataQualityGrade = "A" | "B" | "C" | "D";

export type DataQualityInputs = {
  now: number;
  bybitConnected: boolean;
  orderbookStaleMs: number;
  tradesStaleMs: number;
  kline1mStaleMs: number;
  kline5mStaleMs: number;
};

export function scoreDataQuality(
  i: DataQualityInputs
): {
  score: number;
  grade: DataQualityGrade;
  reasons: string[];
} {
  let score = 100;
  const reasons: string[] = [];

  if (!i.bybitConnected) {
    score -= 40;
    reasons.push("Bybit WS disconnected");
  }

  if (i.orderbookStaleMs > 3000) {
    score -= 25;
    reasons.push(`Orderbook stale ${i.orderbookStaleMs}ms`);
  }

  if (i.tradesStaleMs > 10000) {
    score -= 15;
    reasons.push(`Trades stale ${i.tradesStaleMs}ms`);
  }

  if (i.kline1mStaleMs > 90_000) {
    score -= 20;
    reasons.push(`1m kline stale ${i.kline1mStaleMs}ms`);
  }

  if (i.kline5mStaleMs > 300_000) {
    score -= 10;
    reasons.push(`5m kline stale ${i.kline5mStaleMs}ms`);
  }

  score = Math.max(0, Math.min(100, score));

  let grade: DataQualityGrade;
  if (score >= 85) grade = "A";
  else if (score >= 70) grade = "B";
  else if (score >= 50) grade = "C";
  else grade = "D";

  return { score, grade, reasons };
}
