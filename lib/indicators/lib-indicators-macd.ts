import { ema } from "./ema";

export function macd(series: number[], fast = 12, slow = 26, signal = 9) {
  if (series.length < slow + signal) return { macd: [], signal: [], hist: [] };

  const eFast = ema(series, fast);
  const eSlow = ema(series, slow);

  const macdLine = series.map((_, i) => eFast[i] - eSlow[i]);
  const sigLine = ema(macdLine, signal);
  const hist = macdLine.map((v, i) => v - sigLine[i]);

  return { macd: macdLine, signal: sigLine, hist };
}
