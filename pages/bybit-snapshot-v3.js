import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFullSnapshotV3, buildFullSnapshotV3Compact } from "../lib/snapshot-v3";
import Button from "../components/snapshot/Button";
import { buildCopyCommands } from "../components/ui/helpers/bybit-snapshot-v3-ui-macros";

export default function BybitSnapshotV3New() {
  /* =======================
     CORE STATE
  ======================= */
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [full, setFull] = useState({ snapshot: null, fileName: "" });

  // per-button copied state
  const [copiedKey, setCopiedKey] = useState("");
  const COPIED_RESET_MS = 1200;

  /* =======================
     UI STATE
  ======================= */
  const [openCommands, setOpenCommands] = useState(false);
  const [cmdTab, setCmdTab] = useState("quick"); // quick | analysis | trading | position

  // Generate status
  const [progressPct, setProgressPct] = useState(0);
  const [dots, setDots] = useState("");

  /* =======================
     TOP 100 COINS (Autocomplete)
  ======================= */
  const [topCoins, setTopCoins] = useState([]);
  const [coinsLoading, setCoinsLoading] = useState(false);
  const [coinsErr, setCoinsErr] = useState("");

  const [showSug, setShowSug] = useState(false);
  const [activeSugIndex, setActiveSugIndex] = useState(-1);
  const inputRef = useRef(null);
  const sugRef = useRef(null);

  /* =======================
     HELPERS
  ======================= */
  // Lấy last closed candle trực tiếp từ indicators.last (nguồn chuẩn)
  const getLastClosedFromIndicator = (last, tf, compact) => {
    if (!last || !Number.isFinite(last.ts)) return null;

    const tfMs = tfToMs(tf);
    if (!tfMs) return null;

    const openTs = Number(last.ts);
    const closeTs = openTs + tfMs;

    // ✅ Normalize: indicators.last có thể là open/high/low/close hoặc o/h/l/c
    let o = last.open ?? last.o;
    let h = last.high ?? last.h;
    let l = last.low ?? last.l;
    let c = last.close ?? last.c;

    const hasOHLC =
      [o, h, l, c].every((v) => v !== undefined && v !== null && v !== "");

    // 🔁 Chỉ fallback sang compact nếu thật sự không có OHLC trong indicator.last
    if (!hasOHLC) {
      const k = pickOHLCByTs(compact, openTs);
      if (k) {
        o = k.o ?? k.open;
        h = k.h ?? k.high;
        l = k.l ?? k.low;
        c = k.c ?? k.close;
      }
    }

    return {
      tf: String(tf),
      close_ts: closeTs,
      close_time: fmtLA(closeTs),
      o, h, l, c,
    };
  };

  // =======================
  // LAST CLOSED CANDLE VIEW (America/Los_Angeles)
  // =======================
  const LA_TZ = "America/Los_Angeles";

  const fmtLA = (ms) => {
    if (!Number.isFinite(ms)) return "—";
    return new Date(ms).toLocaleString("en-US", {
      timeZone: LA_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const tfToMs = (tf) => {
    const s = String(tf);
    if (s === "D") return 24 * 60 * 60 * 1000;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n * 60 * 1000 : null;
  };

  // Lấy block symbol từ object-map hoặc array
  const getSymbolBlock = (maybeSymbols, symbol) => {
    if (!maybeSymbols) return null;

    // object-map: symbols[SYMBOL]
    if (!Array.isArray(maybeSymbols)) return maybeSymbols?.[symbol] || null;

    // array: [{ symbol: "ETHUSDT", ... }, ...]
    return maybeSymbols.find((x) => (x?.symbol || x?.name) === symbol) || null;
  };
  const pickOHLCByTs = (compact, targetOpenTs) => {
    const arr = Array.isArray(compact) ? compact : [];
    if (!arr.length) return null;

    const t0 = Number(targetOpenTs);

    // ưu tiên match đúng ts
    if (Number.isFinite(t0)) {
      const exact = arr.find((k) => Number(k?.ts) === t0);
      if (exact) return exact;
    }

    // fallback: lấy candle có ts lớn nhất
    return arr.reduce((best, k) => {
      const t = Number(k?.ts);
      if (!Number.isFinite(t)) return best;
      if (!best) return k;
      return t > Number(best.ts) ? k : best;
    }, null);
  };

  // Trả về 1 row: cây nến gần nhất đã đóng
  // compact: [{ ts, o,h,l,c,... }]
  // candleStatusTf: { is_last_closed, tf_ms, ... } (nếu có)
  const getLastClosedCandleRow = (compact, candleStatusTf, tf) => {
    const arr = Array.isArray(compact) ? compact : [];
    if (!arr.length) return null;

    const tfMs = Number(candleStatusTf?.tf_ms) || tfToMs(tf) || 0;
    if (!tfMs) return null;

    // 1) Ưu tiên dùng last_closed_ts từ candle_status (open ts của cây đã đóng gần nhất)
    const targetOpenTs = Number(candleStatusTf?.last_closed_ts);

    // 2) Chọn candle "đúng cây đã đóng gần nhất" theo targetOpenTs; nếu không có thì fallback bằng max ts
    let chosen = null;

    if (Number.isFinite(targetOpenTs)) {
      chosen = arr.find((k) => Number(k?.ts) === targetOpenTs) || null;
    }

    if (!chosen) {
      // fallback: lấy candle có open ts lớn nhất (không phụ thuộc thứ tự mảng)
      chosen = arr.reduce((best, k) => {
        const t = Number(k?.ts);
        if (!Number.isFinite(t)) return best;
        if (!best) return k;
        return t > Number(best.ts) ? k : best;
      }, null);
    }

    if (!chosen) return null;

    const openTs = Number(chosen.ts);
    const closeTs = Number.isFinite(openTs) ? openTs + tfMs : null;
    if (!Number.isFinite(closeTs)) return null;

    return {
      tf: String(tf),
      close_ts: closeTs,
      close_time: fmtLA(closeTs), // LA timezone
      o: chosen.o,
      h: chosen.h,
      l: chosen.l,
      c: chosen.c,
    };
  };

  const LastClosedTable = ({ rows }) => {
    const safe = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (!safe.length) {
      return <div className="mt-3 text-sm text-slate-400">No closed candles.</div>;
    }

    return (
      <div className="mt-3 overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-slate-200">
            <tr>
              <th className="px-2 py-2 text-left">TF</th>
              <th className="px-2 py-2 text-left">Close time (LA)</th>
              <th className="px-2 py-2 text-right">Open</th>
              <th className="px-2 py-2 text-right">High</th>
              <th className="px-2 py-2 text-right">Low</th>
              <th className="px-2 py-2 text-right">Close</th>
            </tr>
          </thead>
          <tbody className="bg-slate-950 text-slate-100">
            {safe.map((r) => (
              <tr key={r.tf} className="border-t border-slate-800">
                <td className="px-2 py-2 text-left">{r.tf}</td>
                <td className="px-2 py-2 text-left">{r.close_time}</td>
                <td className="px-2 py-2 text-right">{r.o}</td>
                <td className="px-2 py-2 text-right">{r.h}</td>
                <td className="px-2 py-2 text-right">{r.l}</td>
                <td className="px-2 py-2 text-right">{r.c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const haptic = () => {
    try {
      if (navigator?.vibrate) navigator.vibrate(10);
    } catch { }
  };

  const copyText = async (text, key) => {
    try {
      if (!text) return;

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      haptic();

      if (key) {
        setCopiedKey(key);
        setTimeout(() => {
          setCopiedKey((prev) => (prev === key ? "" : prev));
        }, COPIED_RESET_MS);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const normalizeSymbols = (input) =>
    (input || "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

  const symbols = useMemo(() => normalizeSymbols(symbolsText), [symbolsText]);
  const primarySymbol = symbols[0] || "SYMBOL";
  const ready = Boolean(full.fileName);
  const isCompact = useMemo(() => {
    return (full.fileName || "").includes("_compact_") || (full.fileName || "").includes("compact");
  }, [full.fileName]);

  // Commands (SPEC modes) — chỉ dùng trigger hợp lệ
  const snapshotFileName = full.fileName || "";
  const copyCommands = useMemo(() => {
    if (!snapshotFileName) return null;
    return buildCopyCommands(snapshotFileName);
  }, [snapshotFileName]);

  // Simple mobile detection for download behavior/UI
  const isMobile = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const touch = (navigator.maxTouchPoints || 0) > 1;
    return /Android|iPhone|iPad|iPod/i.test(ua) || touch;
  }, []);

  /* =======================
     FETCH TOP 100 COINS
  ======================= */
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    const load = async () => {
      try {
        setCoinsErr("");
        setCoinsLoading(true);

        const url =
          "https://api.coingecko.com/api/v3/coins/markets" +
          "?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false";

        const res = await fetch(url, {
          method: "GET",
          signal: ac.signal,
          headers: { accept: "application/json" },
        });

        if (!res.ok) throw new Error(`Coin list fetch failed (${res.status}).`);

        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Coin list response invalid.");

        const mapped = data
          .map((c) => ({
            id: c.id,
            name: c.name,
            symbol: (c.symbol || "").toUpperCase(),
            market_cap_rank: c.market_cap_rank ?? null,
          }))
          .filter((c) => c.symbol && c.symbol !== "USDT");

        if (alive) setTopCoins(mapped);
      } catch (e) {
        if (!alive) return;
        if (e?.name === "AbortError") return;
        console.error(e);
        setCoinsErr("Không load được Top 100 coins (CoinGecko).");
      } finally {
        if (alive) setCoinsLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
      ac.abort();
    };
  }, []);

  /* =======================
     AUTOCOMPLETE LOGIC
  ======================= */
  const currentToken = useMemo(() => {
    const t = (symbolsText || "").trimEnd();
    const m = t.match(/([^,\s]+)$/);
    return (m?.[1] || "").toUpperCase();
  }, [symbolsText]);

  const suggestions = useMemo(() => {
    const q = currentToken;
    if (!q || q.length < 1) return [];
    const norm = q.toLowerCase();

    return topCoins
      .filter((c) => {
        const sym = (c.symbol || "").toLowerCase();
        const name = (c.name || "").toLowerCase();
        return sym.includes(norm) || name.includes(norm);
      })
      .slice(0, 10);
  }, [topCoins, currentToken]);

  const insertSymbol = (baseSymbolUpper) => {
    const pair = `${baseSymbolUpper}USDT`;

    const raw = symbolsText || "";
    const trimmedEnd = raw.replace(/\s+$/, "");
    const m = trimmedEnd.match(/^(.*?)([^,\s]*)$/);
    const prefix = m?.[1] ?? "";

    setSymbolsText(`${prefix}${pair}`);
    setShowSug(false);
    setActiveSugIndex(-1);

    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onInputKeyDown = (e) => {
    if (!showSug || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSugIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSugIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeSugIndex >= 0 && activeSugIndex < suggestions.length) {
        e.preventDefault();
        insertSymbol(suggestions[activeSugIndex].symbol);
      }
    } else if (e.key === "Escape") {
      setShowSug(false);
      setActiveSugIndex(-1);
    }
  };

  useEffect(() => {
    const onDoc = (ev) => {
      const inInput = inputRef.current?.contains(ev.target);
      const inSug = sugRef.current?.contains(ev.target);
      if (!inInput && !inSug) {
        setShowSug(false);
        setActiveSugIndex(-1);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  /* =======================
     POSITION TEMPLATE (optional helper)
  ======================= */
  const macroPositionShort = useMemo(() => {
    if (!full.fileName) return "";
    return `Mình đang Short ${primarySymbol} @<ENTRY>, SL <SL>\n[DASH] FILE=${full.fileName}`;
  }, [full.fileName, primarySymbol]);

  /* =======================
     GENERATE STATUS (dots)
  ======================= */
  useEffect(() => {
    if (!loading) {
      setDots("");
      return;
    }
    let i = 0;
    const t = setInterval(() => {
      i = (i + 1) % 4;
      setDots(i === 0 ? "" : " " + ". ".repeat(i).trim());
    }, 350);
    return () => clearInterval(t);
  }, [loading]);

  /* =======================
     SNAPSHOT GENERATION
  ======================= */
  const handleGenerateFull = useCallback(async () => {
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol.");
      return;
    }

    setError("");
    setLoading(true);
    setProgressPct(0);

    try {
      setProgressPct(15);

      const fullSnap = await buildFullSnapshotV3(symbols).then((r) => {
        setProgressPct(90);
        return r;
      });

      const ts = fullSnap?.generated_at || Date.now();
      const name = `bybit_full_snapshot_${ts}_${primarySymbol}.json`;
      setFull({ snapshot: fullSnap, fileName: name });

      setProgressPct(100);
    } catch (e) {
      console.error(e);
      setError("Có lỗi khi tạo snapshot.");
      setProgressPct(0);
    } finally {
      setLoading(false);
      setTimeout(() => setProgressPct(0), 800);
    }
  }, [symbols, primarySymbol]);
  const handleGenerateCompact = useCallback(async () => {
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol.");
      return;
    }

    setError("");
    setLoading(true);
    setProgressPct(0);

    try {
      setProgressPct(15);

      const fullSnap = await buildFullSnapshotV3Compact(symbols).then((r) => {
        setProgressPct(90);
        return r;
      });

      const ts = fullSnap?.generated_at || Date.now();
      const name = `bybit_full_snapshot_compact_${ts}_${primarySymbol}.json`;
      setFull({ snapshot: fullSnap, fileName: name });

      setProgressPct(100);
    } catch (e) {
      console.error(e);
      setError("Có lỗi khi tạo snapshot (compact).");
      setProgressPct(0);
    } finally {
      setLoading(false);
      setTimeout(() => setProgressPct(0), 800);
    }
  }, [symbols, primarySymbol]);

  /* =======================
     DOWNLOAD
  ======================= */
  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "download.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadJson = (obj, name) => {
    if (!obj) return;
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    downloadBlob(blob, name);
  };

  const downloadFULL = () => {
    if (!full.snapshot || !full.fileName) return;
    downloadJson(full.snapshot, full.fileName);
  };

  /* =======================
     UI COMPONENTS
  ======================= */
  const TabBtn = ({ id, label }) => (
    <button
      type="button"
      onClick={() => setCmdTab(id)}
      className={[
        "rounded-xl px-3 py-2 text-sm transition",
        cmdTab === id ? "bg-slate-200 text-slate-950" : "bg-black/20 text-slate-200 hover:bg-black/30",
      ].join(" ")}
    >
      {label}
    </button>
  );

  const CommandButton = ({ title, subtitle, text, copyKey, disabled }) => {
    const isCopied = copiedKey === copyKey;

    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => copyText(text, copyKey)}
        className={[
          "w-full rounded-2xl border px-4 py-3 text-left transition",
          disabled
            ? "cursor-not-allowed border-slate-800 bg-black/10 opacity-60"
            : "border-slate-800 bg-black/20 hover:bg-black/30 active:scale-[0.99]",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">{title}</div>
            {subtitle ? <div className="mt-1 text-xs text-slate-400">{subtitle}</div> : null}
            {text ? (
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[12px] text-slate-200">
                {text}
              </pre>
            ) : null}
          </div>

          <div className="shrink-0">
            {isCopied ? (
              <span className="rounded-full border border-emerald-800/60 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-200">
                Copied ✓
              </span>
            ) : (
              <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
                Copy
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  // =======================
  // LAST CLOSED CANDLES DATA (authoritative)
  // =======================

  // LTF block (M5/M15)
  const ltfSymbols = full.snapshot?.per_exchange_ltf?.bybit?.symbols;
  const ltfBlock = getSymbolBlock(ltfSymbols, primarySymbol);

  // HTF block (H1/H4/D1)
  const htfSymbols = full.snapshot?.per_exchange?.bybit?.symbols;
  const htfBlock = getSymbolBlock(htfSymbols, primarySymbol);

  // Indicators (authoritative last closed candle)
  const ltfIndicators = ltfBlock?.indicators_ltf || {};
  const htfIndicators = htfBlock?.indicators || {};
  const ltfK = ltfBlock?.klines_ltf_compact || {};
  const htfK = htfBlock?.klines_compact || {};


  const rowM5 = getLastClosedFromIndicator(ltfIndicators?.["5"]?.last, "5", ltfK?.["5"]);
  const rowM15 = getLastClosedFromIndicator(ltfIndicators?.["15"]?.last, "15", ltfK?.["15"]);

  const rowH1 = getLastClosedFromIndicator(htfIndicators?.["60"]?.last, "60", htfK?.["60"]);
  const rowH4 = getLastClosedFromIndicator(htfIndicators?.["240"]?.last, "240", htfK?.["240"]);
  const rowD1 = getLastClosedFromIndicator(htfIndicators?.["D"]?.last, "D", htfK?.["D"]);


  const lastClosedRows = [rowM5, rowM15, rowH1, rowH4, rowD1].filter(Boolean);

  /* =======================
     RENDER
  ======================= */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-3 pb-28 pt-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-950">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 py-4">
            <div>
              <div className="text-lg font-semibold tracking-tight">📡 Snapshot Console ({isCompact ? "COMPACT" : "FULL"}) — Bybit v3</div>
              <div className="mt-1 text-xs text-slate-400">
                Một file snapshot FULL · Copy commands theo SPEC (DASH/CHECK/PART/SETUPS)
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <span
                className={[
                  "shrink-0 rounded-full px-3 py-1 text-xs border",
                  ready ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-300",
                ].join(" ")}
              >
                {ready ? "Snapshot generated" : "No snapshot"}
              </span>
            </div>
          </div>

          <div className="border-t border-slate-800" />

          {/* Symbols */}
          <div className="p-4">
            <div className="text-sm font-semibold">Symbols</div>
            <div className="mt-1 text-xs text-slate-400">
              Gõ coin name/symbol để auto-fill (Top 100 MC). Primary:{" "}
              <span className="text-slate-200">{primarySymbol}</span>
            </div>

            <div className="relative mt-3">
              <input
                ref={inputRef}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-slate-600"
                value={symbolsText}
                onChange={(e) => {
                  setSymbolsText(e.target.value);
                  setShowSug(true);
                  setActiveSugIndex(-1);
                }}
                onFocus={() => setShowSug(true)}
                onKeyDown={onInputKeyDown}
                placeholder="BTCUSDT, ETHUSDT"
                disabled={loading}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />

              {/* Suggestions */}
              {showSug && (coinsLoading || coinsErr || suggestions.length > 0) && (
                <div
                  ref={sugRef}
                  className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-lg"
                >
                  {coinsLoading ? (
                    <div className="px-3 py-3 text-sm text-slate-300">Loading Top 100 coins…</div>
                  ) : coinsErr ? (
                    <div className="px-3 py-3 text-sm text-red-200">{coinsErr}</div>
                  ) : suggestions.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-slate-400">Không có gợi ý cho “{currentToken}”.</div>
                  ) : (
                    <div className="max-h-72 overflow-auto">
                      {suggestions.map((c, idx) => {
                        const pair = `${c.symbol}USDT`;
                        const active = idx === activeSugIndex;
                        return (
                          <button
                            type="button"
                            key={c.id}
                            onMouseEnter={() => setActiveSugIndex(idx)}
                            onClick={() => insertSymbol(c.symbol)}
                            className={[
                              "flex w-full items-center justify-between px-3 py-2 text-left",
                              active ? "bg-slate-800/60" : "hover:bg-slate-800/40",
                            ].join(" ")}
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-slate-100">
                                {c.name} <span className="text-xs text-slate-400">({c.symbol})</span>
                              </div>
                              <div className="text-xs text-slate-400">
                                Auto-fill: <span className="text-slate-200">{pair}</span>
                              </div>
                            </div>
                            <div className="shrink-0 text-xs text-slate-400">
                              {c.market_cap_rank ? `#${c.market_cap_rank}` : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
                    Tip: dùng ↑ ↓ để chọn, Enter để insert, Esc để đóng.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* File name */}
          <div className="px-4 pb-4">
            <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="text-xs text-slate-400"> Snapshot file ({isCompact ? "COMPACT" : "FULL"})</div>
              <div className="mt-1 break-all text-sm">{full.fileName || "—"}</div>
            </div>
          </div>
          {/* Last closed candles (LA time) */}
          {full.snapshot && (
            <div className="px-4 pb-4">
              <div className="rounded-2xl border border-slate-800 bg-black/20 px-3 py-3">
                <div className="text-xs text-slate-400">
                  Last closed candles (America/Los_Angeles)
                </div>
                <LastClosedTable rows={lastClosedRows} />
              </div>
            </div>
          )}
          {/* Quick actions */}
          <div className="px-4 pb-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
            <Button variant="primary" onClick={handleGenerateFull} disabled={loading}>
              {loading
                ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}`
                : "Generate (FULL snapshot)"}
            </Button>

            <Button variant="secondary" onClick={handleGenerateCompact} disabled={loading}>
              {loading
                ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}`
                : "Generate (COMPACT snapshot)"}
            </Button>

            <Button
              variant="secondary"
              onClick={downloadFULL}
              disabled={!full.snapshot || !full.fileName}
              title={!full.snapshot || !full.fileName ? "Generate snapshot trước" : "Download snapshot JSON"}
            >
              Download JSON
            </Button>

            <Button
              variant="secondary"
              disabled={!copyCommands?.fullDashboard?.command}
              onClick={() => copyText(copyCommands?.fullDashboard?.command, "quick_dash")}
            >
              {copiedKey === "quick_dash" ? "Copied ✓" : "Copy [DASH]"}
            </Button>
          </div>

          {/* Progress hint line */}
          <div className="px-4 pb-4 text-xs text-slate-500">
            {loading ? (
              <span>
                Đang generate snapshot{dots} {progressPct ? `(ước lượng ${progressPct}%)` : ""}
              </span>
            ) : (
              <span>
                Tip: Generate → Download JSON → Upload vào ChatGPT → dùng các lệnh copy đúng mode (DASH/CHECK/PART/SETUPS).
              </span>
            )}
          </div>

          {/* Copy Commands */}
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => setOpenCommands((v) => !v)}
              className="w-full rounded-2xl border border-slate-800 bg-black/20 px-3 py-3 text-left text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">📋 Copy Commands (chuẩn SPEC)</span>
                <span className="text-xs text-slate-400">{openCommands ? "Ẩn ▲" : "Mở ▼"}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Chỉ có trigger hợp lệ: <span className="text-slate-200">[DASH] [CHECK] [PART] [SETUPS]</span>. Bấm 1 lần để
                copy.
              </div>
            </button>

            {openCommands && (
              <div className="mt-3 space-y-3">
                {/* Tabs */}
                <div className="grid grid-cols-4 gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 p-2">
                  <TabBtn id="quick" label="⚡ Quick" />
                  <TabBtn id="analysis" label="🧠 Analysis" />
                  <TabBtn id="trading" label="🎯 Trading" />
                  <TabBtn id="position" label="🧷 Position" />
                </div>

                {/* Tab content */}
                {cmdTab === "quick" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="📊 FULL Dashboard"
                      subtitle="MODE A — Xuất 6 phần + ≥3 setup"
                      text={copyCommands?.fullDashboard?.command || ""}
                      copyKey="cmd_dash"
                      disabled={!copyCommands?.fullDashboard?.command}
                    />

                    <CommandButton
                      title="📋 Setup Summary"
                      subtitle="MODE D — Tóm tắt ≥3 setup (có ENTRY/SL/TP/RR/Score/GO-NO)"
                      text={copyCommands?.setupSummary?.command || ""}
                      copyKey="cmd_setups"
                      disabled={!copyCommands?.setupSummary?.command}
                    />
                  </div>
                )}

                {cmdTab === "analysis" && (
                  <div className="space-y-2">
                    {copyCommands?.partialDashboard?.map((c, idx) => (
                      <CommandButton
                        key={c.command}
                        title={`🧩 ${c.label}`}
                        subtitle={`MODE C — ${c.description}`}
                        text={c.command}
                        copyKey={`cmd_part_${idx}`}
                        disabled={!c.command}
                      />
                    ))}
                  </div>
                )}

                {cmdTab === "trading" && (
                  <div className="space-y-2">
                    {copyCommands?.quickCheck?.map((c, idx) => (
                      <CommandButton
                        key={c.command}
                        title={`⚡ ${c.label}`}
                        subtitle={`MODE B — ${c.description}`}
                        text={c.command}
                        copyKey={`cmd_check_${idx}`}
                        disabled={!c.command}
                      />
                    ))}

                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
                      Gợi ý: muốn check “đúng trạng thái mới nhất” → hãy generate snapshot FULL mới trước khi dùng [CHECK].
                    </div>
                  </div>
                )}

                {cmdTab === "position" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="🧷 Position Template (Short)"
                      subtitle="Dùng khi bạn đang có lệnh. Điền ENTRY/SL, rồi dán vào ChatGPT để AI quản lý theo snapshot."
                      text={macroPositionShort}
                      copyKey="cmd_pos"
                      disabled={!macroPositionShort}
                    />
                  </div>
                )}

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
                  Chuẩn mode theo SPEC:&nbsp;<span className="text-slate-300">[DASH]</span>,{" "}
                  <span className="text-slate-300">[CHECK]</span>,{" "}
                  <span className="text-slate-300">[PART]</span>,{" "}
                  <span className="text-slate-300">[SETUPS]</span>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-4 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom actions (mobile) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-slate-950/90 backdrop-blur sm:hidden">
        <div className="mx-auto max-w-3xl px-3 py-3">
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={handleGenerateFull}
              disabled={loading}
              className="w-full"
            >
              {loading ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}` : "Generate (FULL)"}
            </Button>

            <Button
              onClick={handleGenerateCompact}
              disabled={loading}
              className="w-full"
              variant="secondary"
            >
              {loading ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}` : "Generate (COMPACT)"}
            </Button>

            <Button
              variant="secondary"
              disabled={!copyCommands?.fullDashboard?.command}
              onClick={() => copyText(copyCommands?.fullDashboard?.command || "", "sticky_dash")}
              className="w-full"
            >
              {copiedKey === "sticky_dash" ? "Copied ✓" : "Copy [DASH]"}
            </Button>
          </div>

          <div className="mt-2">
            {/* ✅ Mobile: chặn export khi M5 chưa READY */}
            <Button
              variant="secondary"
              onClick={downloadFULL}
              disabled={!full.snapshot || !full.fileName}
              className="w-full"
            >
              Download JSON
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">
              {loading
                ? `Đang generate${dots}${progressPct ? ` (${progressPct}%)` : ""}`
                : ready
                  ? "Ready: FULL snapshot"
                  : "Chưa có snapshot"
              }
            </span>
            <button type="button" className="underline underline-offset-2" onClick={() => setOpenCommands(true)}>
              Commands
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
