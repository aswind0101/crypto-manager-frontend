import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFullSnapshotV3 } from "../lib/snapshot-v3";
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
  // =======================
  // LTF STATUS (M5/M15) — user-facing
  // =======================
  const fmtLocal = (ms) => {
    if (!Number.isFinite(ms)) return "—";
    // dùng timezone local của máy user (Mỹ thì sẽ ra PST/PDT/EST/…)
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  };

  const ltfUi = useMemo(() => {
    const snap = full.snapshot;
    const sym = primarySymbol;

    const bybit = snap?.per_exchange_ltf?.bybit;
    const block = bybit?.symbols?.[sym];

    const cs = block?.meta?.candle_status || null;
    const m5 = cs?.["5"] || null;
    const m15 = cs?.["15"] || null;

    const trig = block?.ltf_trigger_state || null;

    const tfLine = (label, s) => {
      if (!s) {
        return { label, ok: false, headline: "MISSING", sub: "candle_status missing" };
      }

      // is_last_closed=false => candle hiện tại đang chạy (chưa đóng)
      const closedNow = Boolean(s.is_last_closed);

      const headline = closedNow ? "CLOSED" : "OPEN (forming)";
      const sub = [
        `last_open: ${fmtLocal(s.last_open_ts)}`,
        `last_closed: ${fmtLocal(s.last_closed_ts)}`,
      ].join(" | ");

      return { label, ok: closedNow, headline, sub };
    };

    const m5Line = tfLine("M5", m5);
    const m15Line = tfLine("M15", m15);

    const hardBlock = (() => {
      if (!trig) {
        return { ok: false, headline: "UNKNOWN", sub: "ltf_trigger_state missing" };
      }
      const ok = Boolean(trig.ready);
      return {
        ok,
        headline: ok ? "READY" : "BLOCKED",
        sub: `tf=${trig.tf || "—"} | reason=${trig.reason || "—"} | evaluated_at=${fmtLocal(trig.evaluated_at)}`,
      };
    })();

    return { sym, m5Line, m15Line, hardBlock };
  }, [full.snapshot, primarySymbol]);

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
     - không phải mode riêng trong SPEC, nhưng hữu ích khi user đã có lệnh
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
        cmdTab === id
          ? "bg-slate-200 text-slate-950"
          : "bg-black/20 text-slate-200 hover:bg-black/30",
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
            {subtitle ? (
              <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
            ) : null}
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
              <div className="text-lg font-semibold tracking-tight">
                📡 Snapshot Console (FULL) — Bybit v3
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Một file snapshot FULL · Copy commands theo SPEC (DASH/CHECK/PART/SETUPS)
              </div>
            </div>

            <span
              className={[
                "shrink-0 rounded-full px-3 py-1 text-xs",
                ready
                  ? "border border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
                  : "border border-slate-700 bg-slate-900 text-slate-300",
              ].join(" ")}
            >
              {ready ? "Ready" : "No snapshot"}
            </span>
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
                    <div className="px-3 py-3 text-sm text-slate-300">
                      Loading Top 100 coins…
                    </div>
                  ) : coinsErr ? (
                    <div className="px-3 py-3 text-sm text-red-200">{coinsErr}</div>
                  ) : suggestions.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-slate-400">
                      Không có gợi ý cho “{currentToken}”.
                    </div>
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
                                {c.name}{" "}
                                <span className="text-xs text-slate-400">({c.symbol})</span>
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
              <div className="text-xs text-slate-400">Snapshot file (FULL)</div>
              <div className="mt-1 break-all text-sm">{full.fileName || "—"}</div>
            </div>
          </div>
          {/* LTF Candle Status (user-facing) */}
          {full.snapshot && (
            <div className="px-4 pb-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
                <div className="text-xs text-slate-400">LTF Closed-Candle Status (at export time)</div>

                {/* Hard blocker */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={[
                      "rounded-full px-3 py-1 text-xs border",
                      ltfUi?.hardBlock?.ok
                        ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
                        : "border-red-900/60 bg-red-950/30 text-red-200",
                    ].join(" ")}
                  >
                    Hard Blocker: {ltfUi?.hardBlock?.headline || "—"}
                  </span>

                  <span className="text-[11px] text-slate-400">{ltfUi?.hardBlock?.sub || ""}</span>
                </div>

                {/* M5 / M15 */}
                <div className="mt-3 space-y-2">
                  {[ltfUi?.m5Line, ltfUi?.m15Line].map((x) => (
                    <div key={x?.label} className="flex items-start justify-between gap-3">
                      <span
                        className={[
                          "shrink-0 rounded-full px-3 py-1 text-xs border",
                          x?.ok
                            ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-200"
                            : "border-amber-900/60 bg-amber-950/30 text-amber-200",
                        ].join(" ")}
                      >
                        {x?.label}: {x?.headline}
                      </span>
                      <span className="min-w-0 text-[11px] text-slate-400">{x?.sub || ""}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 text-[11px] text-slate-500">
                  Rule: chỉ khi candle đã đóng mới được dùng để trigger/entry; nếu OPEN (forming) thì phải generate lại sau.
                </div>
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div className="px-4 pb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="primary" onClick={handleGenerateFull} disabled={loading}>
              {loading
                ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}`
                : "Generate (FULL snapshot)"}
            </Button>

            <Button
              variant="secondary"
              onClick={downloadFULL}
              disabled={!full.snapshot || !full.fileName}
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
                Đang generate snapshot{dots}{" "}
                {progressPct ? `(ước lượng ${progressPct}%)` : ""}
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
                Chỉ có trigger hợp lệ: <span className="text-slate-200">[DASH] [CHECK] [PART] [SETUPS]</span>. Bấm 1 lần để copy.
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
                  Chuẩn mode theo SPEC:&nbsp;
                  <span className="text-slate-300">[DASH]</span>,{" "}
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
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={handleGenerateFull} disabled={loading}>
              {loading
                ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}`
                : "Generate"}
            </Button>

            <Button
              variant="secondary"
              disabled={!copyCommands?.fullDashboard?.command}
              onClick={() => copyText(copyCommands?.fullDashboard?.command || "", "sticky_dash")}
            >
              {copiedKey === "sticky_dash" ? "Copied ✓" : "Copy [DASH]"}
            </Button>
          </div>

          <div className="mt-2">
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
                  : "Chưa có snapshot"}
            </span>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => setOpenCommands(true)}
            >
              Commands
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}