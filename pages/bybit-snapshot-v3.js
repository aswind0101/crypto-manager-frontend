import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSnapshotV3, buildLtfSnapshotV3 } from "../lib/snapshot-v3";
import Button from "../components/snapshot/Button";

export default function BybitSnapshotV3New() {
  /* =======================
     CORE STATE
  ======================= */
  const [symbolsText, setSymbolsText] = useState("BTCUSDT");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [htf, setHtf] = useState({ snapshot: null, fileName: "" });
  const [ltf, setLtf] = useState({ snapshot: null, fileName: "" });

  // per-button copied state
  const [copiedKey, setCopiedKey] = useState("");
  const COPIED_RESET_MS = 1200;

  /* =======================
     UI STATE
  ======================= */
  const [openCommands, setOpenCommands] = useState(false);
  const [cmdTab, setCmdTab] = useState("quick"); // quick | trading | position

  // Generate status
  const [progressPct, setProgressPct] = useState(0);
  const [dots, setDots] = useState("");

  /* =======================
     TOP 100 COINS (Autocomplete)
  ======================= */
  const [topCoins, setTopCoins] = useState([]); // [{id,name,symbol,market_cap_rank}]
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
    } catch {}
  };

  const copyText = async (text, _okMsg, key) => {
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

      // IMPORTANT: Không toast, không auto-close theo yêu cầu
    } catch (e) {
      console.error(e);
      // Không toast; nếu muốn có thể setError nhẹ ở đây, nhưng hiện giữ im lặng đúng yêu cầu “bỏ toast”
    }
  };

  const normalizeSymbols = (input) =>
    (input || "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

  const symbols = useMemo(() => normalizeSymbols(symbolsText), [symbolsText]);
  const primarySymbol = symbols[0] || "SYMBOL";
  const ready = Boolean(htf.fileName && ltf.fileName);

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
          // avoid weird suggestions like USDTUSDT
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

  // get last token user is typing (after last space/comma)
  const currentToken = useMemo(() => {
    const t = (symbolsText || "").trimEnd();
    const m = t.match(/([^,\s]+)$/);
    return (m?.[1] || "").toUpperCase();
  }, [symbolsText]);

  const suggestions = useMemo(() => {
    const q = currentToken;
    if (!q || q.length < 1) return [];

    const norm = q.toLowerCase();
    const out = topCoins
      .filter((c) => {
        const sym = (c.symbol || "").toLowerCase();
        const name = (c.name || "").toLowerCase();
        return sym.includes(norm) || name.includes(norm);
      })
      .slice(0, 10);

    return out;
  }, [topCoins, currentToken]);

  const insertSymbol = (baseSymbolUpper) => {
    const pair = `${baseSymbolUpper}USDT`;

    // Replace the last token with pair
    const raw = symbolsText || "";
    const trimmedEnd = raw.replace(/\s+$/, "");
    const m = trimmedEnd.match(/^(.*?)([^,\s]*)$/);
    const prefix = m?.[1] ?? "";
    const newText = `${prefix}${pair}`;

    setSymbolsText(newText);

    setShowSug(false);
    setActiveSugIndex(-1);

    // keep focus for fast multi-select
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

  // click outside to close suggestions
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
     MACROS
  ======================= */
  const macroFULL = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const macroPartIV = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const macroPartIVSetup1 = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV, tập trung Setup 1`;
    }
    return "";
  }, [htf.fileName, ltf.fileName]);

  const macroPartIandII = useMemo(() => {
    if (htf.fileName) {
      return `[DASH] FILE=${htf.fileName}\nchỉ render PHẦN I và PHẦN II`;
    }
    return "";
  }, [htf.fileName]);

  // Non-DASH (always usable; doesn't require files)
  const macroSetup1Only = useMemo(() => {
    return `Kiểm tra Setup 1 ${primarySymbol} theo snapshot mới (không dùng [DASH])`;
  }, [primarySymbol]);

  // Position template (requires files)
  const macroPositionShort = useMemo(() => {
    if (htf.fileName && ltf.fileName) {
      return `Mình đang Short ${primarySymbol} @<ENTRY>, SL <SL>\n[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`;
    }
    return "";
  }, [htf.fileName, ltf.fileName, primarySymbol]);

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
      i = (i + 1) % 4; // 0..3
      setDots(i === 0 ? "" : " " + ". ".repeat(i).trim());
    }, 350);
    return () => clearInterval(t);
  }, [loading]);

  /* =======================
     SNAPSHOT GENERATION
  ======================= */
  const handleGenerateBoth = useCallback(async () => {
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol.");
      return;
    }

    setError("");
    setLoading(true);
    setProgressPct(0);

    try {
      setProgressPct(15);

      // Track progress in coarse steps (cannot know real progress inside builder)
      const htfP = buildSnapshotV3(symbols).then((r) => {
        setProgressPct(55);
        return r;
      });

      const ltfP = buildLtfSnapshotV3(symbols).then((r) => {
        setProgressPct(90);
        return r;
      });

      const [htfSnap, ltfSnap] = await Promise.all([htfP, ltfP]);

      const htfTs = htfSnap?.generated_at || Date.now();
      const ltfTs = ltfSnap?.generated_at || Date.now();

      const htfName = `bybit_snapshot_${htfTs}_${primarySymbol}.json`;
      const ltfName = `bybit_ltf_snapshot_${ltfTs}_${primarySymbol}.json`;

      setHtf({ snapshot: htfSnap, fileName: htfName });
      setLtf({ snapshot: ltfSnap, fileName: ltfName });

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
  const downloadJson = (obj, name) => {
    if (!obj) return;

    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = name || "snapshot.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  };

  const downloadBoth = () => {
    if (!htf.snapshot || !ltf.snapshot) return;

    downloadJson(htf.snapshot, htf.fileName);
    setTimeout(() => downloadJson(ltf.snapshot, ltf.fileName), 150);
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
        onClick={() => copyText(text, `Copied: ${title}`, copyKey)}
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
                Snapshot Console v3
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Autocomplete Top 100 (Market Cap) · Generate progress · Per-button copied state · No toast
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
              {ready ? "Ready" : "No files"}
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
                    <div className="px-3 py-3 text-sm text-red-200">
                      {coinsErr}
                    </div>
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
                              active
                                ? "bg-slate-800/60"
                                : "hover:bg-slate-800/40",
                            ].join(" ")}
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-slate-100">
                                {c.name}{" "}
                                <span className="text-xs text-slate-400">
                                  ({c.symbol})
                                </span>
                              </div>
                              <div className="text-xs text-slate-400">
                                Auto-fill:{" "}
                                <span className="text-slate-200">{pair}</span>
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

          {/* File names */}
          <div className="px-4 pb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="text-xs text-slate-400">HTF file</div>
              <div className="mt-1 break-all text-sm">
                {htf.fileName || "—"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-black/20 px-3 py-2">
              <div className="text-xs text-slate-400">LTF file</div>
              <div className="mt-1 break-all text-sm">
                {ltf.fileName || "—"}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="px-4 pb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              variant="primary"
              onClick={handleGenerateBoth}
              disabled={loading}
            >
              {loading
                ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}`
                : "Generate (HTF + LTF)"}
            </Button>

            <Button
              variant="secondary"
              onClick={downloadBoth}
              disabled={!htf.snapshot || !ltf.snapshot}
            >
              Download HTF + LTF
            </Button>

            <Button
              variant="secondary"
              disabled={!macroFULL}
              onClick={() =>
                copyText(macroFULL, "Copied FULL macro", "quick_full")
              }
            >
              {copiedKey === "quick_full" ? "Copied ✓" : "Copy FULL Macro"}
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
              <span>Tip: Generate xong → Copy FULL Macro để dán vào ChatGPT.</span>
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
                <span className="font-semibold">Copy Commands</span>
                <span className="text-xs text-slate-400">
                  {openCommands ? "Ẩn ▲" : "Mở ▼"}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Mỗi lệnh có chú thích; bấm 1 lần để copy. (Copy xong không tự đóng)
              </div>
            </button>

            {openCommands && (
              <div className="mt-3 space-y-3">
                {/* Tabs */}
                <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 p-2">
                  <TabBtn id="quick" label="Quick" />
                  <TabBtn id="trading" label="Trading" />
                  <TabBtn id="position" label="Position" />
                </div>

                {/* Tab content */}
                {cmdTab === "quick" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="FULL Macro"
                      subtitle="Kích hoạt dashboard theo SPEC: dùng cả 2 file HTF + LTF (1 dòng)."
                      text={macroFULL}
                      copyKey="cmd_full"
                      disabled={!macroFULL}
                    />

                    <CommandButton
                      title="Setup 1 only (no DASH)"
                      subtitle="Hỏi riêng Setup 1 mà không bật dashboard (không bị rule ≥ 3 setup)."
                      text={macroSetup1Only}
                      copyKey="cmd_setup1"
                      disabled={false}
                    />

                    <CommandButton
                      title="PHẦN I + II (Bias/Trend)"
                      subtitle="Chỉ render Market Mode + Trend Radar để quyết định ưu tiên Long/Short."
                      text={macroPartIandII}
                      copyKey="cmd_i_ii"
                      disabled={!macroPartIandII}
                    />
                  </div>
                )}

                {cmdTab === "trading" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="PHẦN IV (Trade Zone)"
                      subtitle="Chỉ render Trade Zone Terminal để xem entry/SL/TP nhanh (vẫn đúng rule ≥ 3 setup)."
                      text={macroPartIV}
                      copyKey="cmd_iv"
                      disabled={!macroPartIV}
                    />

                    <CommandButton
                      title="PHẦN IV · Focus Setup 1"
                      subtitle="Tập trung Setup 1; setup 2 & 3 vẫn xuất tối giản để hợp lệ SPEC."
                      text={macroPartIVSetup1}
                      copyKey="cmd_iv_s1"
                      disabled={!macroPartIVSetup1}
                    />
                  </div>
                )}

                {cmdTab === "position" && (
                  <div className="space-y-2">
                    <CommandButton
                      title="Position Template (Short)"
                      subtitle="Dùng khi bạn đang có lệnh: điền ENTRY/SL để AI ưu tiên quản lý vị thế theo snapshot."
                      text={macroPositionShort}
                      copyKey="cmd_pos"
                      disabled={!macroPositionShort}
                    />
                  </div>
                )}

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
                  FULL macro format:&nbsp;
                  <span className="text-slate-300">
                    [DASH] FILE=HTF FILE=LTF
                  </span>
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
            <Button
              variant="primary"
              onClick={handleGenerateBoth}
              disabled={loading}
            >
              {loading
                ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}`
                : "Generate"}
            </Button>

            <Button
              variant="secondary"
              disabled={!macroFULL}
              onClick={() =>
                copyText(macroFULL, "Copied FULL macro", "sticky_full")
              }
            >
              {copiedKey === "sticky_full" ? "Copied ✓" : "Copy FULL"}
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">
              {loading
                ? `Đang generate${dots}${progressPct ? ` (${progressPct}%)` : ""}`
                : ready
                ? "Ready: HTF + LTF files"
                : "Chưa có đủ HTF + LTF"}
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
