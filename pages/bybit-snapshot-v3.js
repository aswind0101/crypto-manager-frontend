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
    } catch {}
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
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? "" : prev));
      }, COPIED_RESET_MS);
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
  const ready = Boolean(htf.fileName && ltf.fileName);

  /* =======================
     FETCH TOP 100 COINS
  ======================= */
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    const load = async () => {
      try {
        setCoinsLoading(true);
        const url =
          "https://api.coingecko.com/api/v3/coins/markets" +
          "?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false";

        const res = await fetch(url, { signal: ac.signal });
        const data = await res.json();

        if (alive) {
          setTopCoins(
            data
              .map((c) => ({
                id: c.id,
                name: c.name,
                symbol: (c.symbol || "").toUpperCase(),
                market_cap_rank: c.market_cap_rank,
              }))
              .filter((c) => c.symbol && c.symbol !== "USDT")
          );
        }
      } catch (e) {
        if (alive) setCoinsErr("Không load được Top 100 coins.");
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
     AUTOCOMPLETE
  ======================= */
  const currentToken = useMemo(() => {
    const t = symbolsText.trimEnd();
    const m = t.match(/([^,\s]+)$/);
    return (m?.[1] || "").toUpperCase();
  }, [symbolsText]);

  const suggestions = useMemo(() => {
    if (!currentToken) return [];
    const q = currentToken.toLowerCase();
    return topCoins
      .filter(
        (c) =>
          c.symbol.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [topCoins, currentToken]);

  const insertSymbol = (sym) => {
    const pair = `${sym}USDT`;
    const raw = symbolsText.replace(/\s+$/, "");
    const m = raw.match(/^(.*?)([^,\s]*)$/);
    setSymbolsText(`${m?.[1] || ""}${pair}`);
    setShowSug(false);
    setActiveSugIndex(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /* =======================
     MACROS
  ======================= */
  const macroFULL = ready
    ? `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`
    : "";

  const macroPartIV = ready
    ? `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV`
    : "";

  const macroPartIVSetup1 = ready
    ? `[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}\nchỉ render PHẦN IV, tập trung Setup 1`
    : "";

  const macroPartIandII = htf.fileName
    ? `[DASH] FILE=${htf.fileName}\nchỉ render PHẦN I và PHẦN II`
    : "";

  const macroSetup1Only = `Kiểm tra Setup 1 ${primarySymbol} theo snapshot mới (không dùng [DASH])`;

  const macroPositionShort = ready
    ? `Mình đang Short ${primarySymbol} @<ENTRY>, SL <SL>\n[DASH] FILE=${htf.fileName} FILE=${ltf.fileName}`
    : "";

  /* =======================
     GENERATE STATUS
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
     GENERATE
  ======================= */
  const handleGenerateBoth = useCallback(async () => {
    if (!symbols.length) {
      setError("Vui lòng nhập ít nhất 1 symbol.");
      return;
    }

    setError("");
    setLoading(true);
    setProgressPct(10);

    try {
      const htfP = buildSnapshotV3(symbols).then((r) => {
        setProgressPct(55);
        return r;
      });
      const ltfP = buildLtfSnapshotV3(symbols).then((r) => {
        setProgressPct(90);
        return r;
      });

      const [htfSnap, ltfSnap] = await Promise.all([htfP, ltfP]);

      const ts = Date.now();
      setHtf({ snapshot: htfSnap, fileName: `bybit_snapshot_${ts}_${primarySymbol}.json` });
      setLtf({ snapshot: ltfSnap, fileName: `bybit_ltf_snapshot_${ts}_${primarySymbol}.json` });

      setProgressPct(100);
    } catch {
      setError("Có lỗi khi tạo snapshot.");
      setProgressPct(0);
    } finally {
      setLoading(false);
      setTimeout(() => setProgressPct(0), 800);
    }
  }, [symbols, primarySymbol]);

  /* =======================
     UI
  ======================= */
  const CommandButton = ({ title, subtitle, text, keyId, disabled }) => (
    <button
      disabled={disabled}
      onClick={() => copyText(text, keyId)}
      className={`w-full rounded-2xl border px-4 py-3 text-left ${
        disabled
          ? "border-slate-800 bg-black/10 opacity-60"
          : "border-slate-800 bg-black/20 hover:bg-black/30"
      }`}
    >
      <div className="flex justify-between">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-slate-400 mt-1">{subtitle}</div>
        </div>
        <span className="text-xs">
          {copiedKey === keyId ? "Copied ✓" : "Copy"}
        </span>
      </div>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-3 pt-6 pb-28">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-950">
        {/* Header */}
        <div className="px-4 py-4 flex justify-between">
          <div>
            <div className="text-lg font-semibold">Snapshot Console v3</div>
            <div className="text-xs text-slate-400">
              Autocomplete · Generate progress · No toast
            </div>
          </div>
          <span className="text-xs px-3 py-1 rounded-full border">
            {ready ? "Ready" : "No files"}
          </span>
        </div>

        {/* Symbols */}
        <div className="px-4 pb-4">
          <input
            ref={inputRef}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-3"
            value={symbolsText}
            onChange={(e) => {
              setSymbolsText(e.target.value);
              setShowSug(true);
            }}
            placeholder="BTCUSDT, ETHUSDT"
          />
        </div>

        {/* Generate */}
        <div className="px-4 pb-2">
          <Button variant="primary" onClick={handleGenerateBoth} disabled={loading}>
            {loading
              ? `Generating${dots}${progressPct ? ` · ${progressPct}%` : ""}`
              : "Generate (HTF + LTF)"}
          </Button>
        </div>

        {/* Copy commands */}
        <div className="px-4 pb-4">
          <CommandButton
            title="FULL Macro"
            subtitle="Kích hoạt dashboard theo SPEC với HTF + LTF"
            text={macroFULL}
            keyId="full"
            disabled={!macroFULL}
          />
        </div>

        {error && (
          <div className="mx-4 mb-4 rounded-xl bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
