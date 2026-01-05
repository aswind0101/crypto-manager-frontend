export async function measureClockSkewMs(fetchServerTime: () => Promise<number>): Promise<number> {
  const t0 = Date.now();
  const server = await fetchServerTime();
  const t1 = Date.now();
  const rtt = t1 - t0;
  // Ước lượng server time tại mid-point
  const localMid = t0 + Math.floor(rtt / 2);
  return server - localMid;
}
