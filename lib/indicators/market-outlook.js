// lib/indicators/market-outlook.js
// Market Outlook v1 (Retail-ready, deterministic, setup-centric EXTENDED)
// Backward compatible with existing UI

/* ===========================
   Helpers (giữ nguyên + bổ sung)
=========================== */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function safeNum(x) { return Number.isFinite(x) ? x : null; }
function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

function trendLabelToVN(label) {
  if (label === "bull") return { bias: "Tăng", tone: "tăng" };
  if (label === "bear") return { bias: "Giảm", tone: "giảm" };
  return { bias: "Đi ngang", tone: "đi ngang" };
}

function strengthToVN(strength) {
  if (!Number.isFinite(strength)) return "Chưa rõ";
  if (strength >= 0.65) return "Mạnh";
  if (strength >= 0.45) return "Vừa";
  if (strength >= 0.25) return "Yếu";
  return "Chưa rõ";
}

function qualityToVN(q) {
  if (q === "ok") return "Đủ dữ liệu";
  if (q === "partial") return "Thiếu một phần dữ liệu";
  if (q === "unavailable") return "Thiếu dữ liệu";
  return "Không rõ";
}

/* ===========================
   Dictionaries (giữ nguyên)
=========================== */
export const TYPE_VN = {
  reversal_sweep: "Đảo chiều",
  breakout: "Phá vỡ",
  trend_continuation: "Tiếp diễn",
};

export const TF_VN = {
  "5": "5m",
  "15": "15m",
  "60": "1H",
  "240": "4H",
  "D": "1D",
};

export const REASON_VN = {
  inside_entry_zone: "Giá đã vào đúng vùng, có thể đặt lệnh.",
  reversal_confirmed: "Có tín hiệu đảo chiều, ưu tiên kèo này.",
  waiting_pullback_to_zone: "Chờ giá hồi về vùng vào lệnh, không đuổi.",
  waiting_trigger: "Chưa đủ dấu hiệu xác nhận, tạm đứng ngoài.",
  waiting_reversal_confirmation: "Chờ tín hiệu xác nhận rồi mới vào.",
  price_too_far_from_entry_zone: "Giá chạy xa vùng vào, bỏ kèo để tránh FOMO.",
  price_beyond_invalidation: "Giá đã vượt điểm hỏng kèo, không vào nữa.",
  not_tradable: "Kèo này không đẹp, nên bỏ để tránh rủi ro.",
  avoid_chasing: "Không đuổi giá lúc này.",
  rr_is_modest: "Lợi nhuận kỳ vọng không cao, cân nhắc giảm khối lượng.",
  ref_price_missing: "Thiếu giá tham chiếu, không thể ra quyết định vào lệnh.",
};

function translateReasonsVN(reasons) {
  const rs = Array.isArray(reasons) ? reasons : [];
  const out = [];
  for (const r of rs) if (REASON_VN[r]) out.push(REASON_VN[r]);
  if (!out.length && rs.length) out.push("Đang chờ điều kiện phù hợp hơn.");
  if (!out.length) out.push("Theo dõi thêm trước khi hành động.");
  return uniq(out);
}

/* ===========================
   Summaries (giữ nguyên)
=========================== */
function fundingSummaryVN(fundingLabels) {
  const labels = [fundingLabels?.bybit, fundingLabels?.binance, fundingLabels?.okx].filter(Boolean);
  const pos = labels.includes("positive_extreme");
  const neg = labels.includes("negative_extreme");
  if (pos && !neg) return { flag: "funding_extreme_pos", text: "Phí giữ lệnh đang cao, dễ bị giật xuống." };
  if (neg && !pos) return { flag: "funding_extreme_neg", text: "Phí giữ lệnh đang thấp, dễ bị giật lên." };
  if (pos && neg) return { flag: "funding_divergent_extremes", text: "Phí giữ lệnh lệch giữa sàn, dễ nhiễu." };
  return { flag: null, text: null };
}

function leverageRegimeVN(lev) {
  if (lev === "risk_on") return { flag: "leverage_risk_on", text: "Đòn bẩy đang cao, biến động có thể mạnh." };
  if (lev === "risk_off") return { flag: "leverage_risk_off", text: "Đòn bẩy đang co lại, giá có thể chậm hơn." };
  return { flag: null, text: null };
}

function liquidationPulseVN(liqFeatures) {
  const observed = !!liqFeatures?.observed;
  const inten = safeNum(liqFeatures?.intensity_15m);
  const bias = safeNum(liqFeatures?.bias);
  if (!observed) return { flag: null, text: null, level: "none" };

  let level = "low";
  if (Number.isFinite(inten)) {
    if (inten > 0.15) level = "high";
    else if (inten > 0.05) level = "mid";
  }

  let biasText = null;
  if (Number.isFinite(bias)) {
    if (bias > 0.25) biasText = "Nhiều lệnh Short bị quét, lực đẩy lên đang mạnh.";
    else if (bias < -0.25) biasText = "Nhiều lệnh Long bị quét, lực đạp xuống đang mạnh.";
  }

  const baseText =
    level === "high" ? "Đang có sóng quét mạnh, giá dễ giật nhanh."
    : level === "mid" ? "Có quét nhẹ, giá có thể rung lắc."
    : "Quét ít, giá thường chạy đều hơn.";

  return {
    flag: level === "high" ? "liquidation_pulse_high" : level === "mid" ? "liquidation_pulse_mid" : "liquidation_pulse_low",
    text: biasText ? `${baseText} ${biasText}` : baseText,
    level,
  };
}

function orderflowVN(ofBlock) {
  const cands = ["bybit", "binance", "okx"]
    .map((ex) => ({ ex, ...((ofBlock && ofBlock[ex]) || {}) }))
    .filter((x) => Number.isFinite(x?.confidence));

  if (!cands.length) return { flag: "orderflow_missing", text: "Dòng tiền ngắn hạn chưa rõ (thiếu dữ liệu)." };

  cands.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const top = cands[0];
  const bi = safeNum(top.book_imbalance);
  const dn = safeNum(top.delta_notional);

  let dir = "trung lập";
  if (Number.isFinite(bi)) {
    if (bi > 0.20) dir = "nghiêng mua";
    else if (bi < -0.20) dir = "nghiêng bán";
  }
  if (dir === "trung lập" && Number.isFinite(dn)) {
    if (dn > 0) dir = "nghiêng mua";
    else if (dn < 0) dir = "nghiêng bán";
  }

  if (dir === "nghiêng mua") return { flag: "orderflow_buying", text: "Dòng tiền ngắn hạn đang nghiêng về mua." };
  if (dir === "nghiêng bán") return { flag: "orderflow_selling", text: "Dòng tiền ngắn hạn đang nghiêng về bán." };
  return { flag: "orderflow_neutral", text: "Dòng tiền ngắn hạn khá cân bằng." };
}

function volatilityRiskVN(atrPct) {
  const x = safeNum(atrPct);
  if (!Number.isFinite(x)) return { flag: "volatility_unknown", text: "Chưa đủ dữ liệu để đánh giá độ rung." };
  if (x < 0.003) return { flag: "vol_low_chop_risk", text: "Biên dao động thấp, dễ đi ngang và quét nhẹ." };
  if (x > 0.030) return { flag: "vol_high_whipsaw_risk", text: "Biên dao động cao, giá dễ giật mạnh." };
  if (x > 0.015) return { flag: "vol_mid_high", text: "Biên dao động đang khá lớn, nên vào lệnh chặt chẽ." };
  return { flag: "vol_normal", text: "Biên dao động bình thường." };
}

function readinessToVN(execState) {
  const phase = execState?.phase || "waiting";
  if (phase === "ready") return { label: "Vào được", color: "good" };
  if (phase === "waiting") return { label: "Đang chờ", color: "neutral" };
  if (phase === "missed") return { label: "Bỏ kèo", color: "bad" };
  if (phase === "invalidated") return { label: "Kèo hỏng", color: "bad" };
  return { label: "Đang chờ", color: "neutral" };
}

function pickTfFeat(tfFeatures, tfKey) {
  const t = tfFeatures?.[tfKey];
  return t && t.last ? t : null;
}

function horizonBiasFromTfs(tfFeatures, keys) {
  const labels = keys.map((k) => pickTfFeat(tfFeatures, k)?.labels?.trend).filter(Boolean);
  if (!labels.length) return "range";
  let bull = 0, bear = 0;
  for (const l of labels) {
    if (l === "bull") bull++;
    else if (l === "bear") bear++;
  }
  if (bull > bear) return "bull";
  if (bear > bull) return "bear";
  return "range";
}

function computeStrengthFallback(snapshot, regimeStrengthMaybe, tfFeatures) {
  if (Number.isFinite(regimeStrengthMaybe)) return clamp01(regimeStrengthMaybe);
  const sTrend = snapshot?.unified?.scores?.trend;
  if (Number.isFinite(sTrend)) return clamp01(sTrend);
  const keys = ["15", "60", "240", "D"];
  const labels = keys.map((k) => pickTfFeat(tfFeatures, k)?.labels?.trend).filter(Boolean);
  if (!labels.length) return null;
  const agree = Math.max(
    labels.filter(l => l === "bull").length,
    labels.filter(l => l === "bear").length
  );
  if (agree >= 3) return 0.65;
  if (agree === 2) return 0.45;
  return 0.30;
}

/* ===========================
   NEW: Setup-centric helpers
=========================== */
function computeContextFit(setup, ctx) {
  let score = 0.5;
  if (!setup) return score;

  const bias = setup.bias;
  if (bias && ctx?.trend_htf) {
    if ((bias === "Long" && ctx.trend_htf === "bull") ||
        (bias === "Short" && ctx.trend_htf === "bear")) score += 0.2;
  }

  if (ctx?.orderflow_bias) {
    if ((bias === "Long" && ctx.orderflow_bias === "buy") ||
        (bias === "Short" && ctx.orderflow_bias === "sell")) score += 0.1;
  }

  if (ctx?.liq_level === "high") score -= 0.1;
  if (setup?.execution_state?.phase === "ready") score += 0.1;
  if (setup?.execution_state?.phase === "missed") score -= 0.2;

  return clamp01(score);
}

function explainSetup(setup, ctx) {
  const out = {
    why_this_setup: [],
    entry_tactics: [],
    invalidation: [],
    management: [],
  };

  if (setup?.trigger) out.why_this_setup.push(`Trigger: ${setup.trigger}.`);
  if (ctx?.trend_htf) out.why_this_setup.push(`Xu hướng khung lớn đang ${trendLabelToVN(ctx.trend_htf).tone}.`);
  if (ctx?.orderflow_text) out.why_this_setup.push(ctx.orderflow_text);

  if (setup?.entry_zone) out.entry_tactics.push("Ưu tiên vào lệnh trong vùng entry, không đuổi giá.");
  if (ctx?.vol_risk) out.entry_tactics.push(ctx.vol_risk);

  if (setup?.stop) out.invalidation.push(`Kèo hỏng nếu giá chạm stop ${setup.stop}.`);
  if (setup?.execution_state?.phase === "invalidated") out.invalidation.push("Kèo đã hỏng, không vào lại.");

  out.management.push("Chốt một phần tại TP1, dời SL về hòa vốn.");
  out.management.push("Không tăng khối lượng khi giá đã chạy xa.");

  return out;
}

/* ===========================
   MAIN BUILDER (EXTENDED)
=========================== */
export function buildMarketOutlookV1(snapshot) {
  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const of = snapshot?.unified?.features?.orderflow || {};
  const anchor = snapshot?.unified?.anchor_layer;

  const setups = snapshot?.unified?.setups_v2 || {};
  const primary = setups?.primary || null;

  const quality = snapshot?.unified?.data_quality || "unknown";
  const regime = setups?.regime || null;

  const fundSum = fundingSummaryVN(deriv?.funding_labels);
  const levSum = leverageRegimeVN(deriv?.derivatives_synthesis?.leverage_regime);
  const liqSum = liquidationPulseVN(deriv?.liquidation_features);
  const ofSum = orderflowVN(of);

  const atrPct60 = anchor?.volatility?.atr_pct?.["60"] ?? null;
  const atrPct240 = anchor?.volatility?.atr_pct?.["240"] ?? null;
  const atrPctD = anchor?.volatility?.atr_pct?.["D"] ?? null;

  const strength = computeStrengthFallback(snapshot, regime?.strength, tfFeatures);

  /* ---------- CONTEXT (NEW) ---------- */
  const context = {
    regime: regime || null,
    trend_by_tf: Object.keys(tfFeatures).reduce((acc, k) => {
      acc[k] = tfFeatures[k]?.labels || null;
      return acc;
    }, {}),
    volatility_by_tf: anchor?.volatility?.atr_pct || {},
    derivatives: {
      funding: fundSum.text,
      leverage: levSum.text,
      liquidation: liqSum.text,
    },
    orderflow: {
      bias: ofSum.flag === "orderflow_buying" ? "buy"
          : ofSum.flag === "orderflow_selling" ? "sell"
          : "neutral",
      text: ofSum.text,
    },
  };

  /* ---------- SETUPS OVERVIEW (NEW) ---------- */
  const allSetups = uniq([
    ...(setups?.top_candidates || []),
    ...(setups?.candidates_all || []),
  ]);

  const ctxForFit = {
    trend_htf: horizonBiasFromTfs(tfFeatures, ["240", "D"]),
    orderflow_bias: context.orderflow.bias,
    orderflow_text: context.orderflow.text,
    liq_level: liqSum.level,
    vol_risk: volatilityRiskVN(atrPct60)?.text,
  };

  const items = allSetups.map((s, idx) => {
    const context_fit = computeContextFit(s, ctxForFit);
    return {
      id: `${s.symbol}_${idx}`,
      symbol: s.symbol,
      type: s.type,
      bias: s.bias,
      tf: s.timeframe,
      entry_zone: s.entry_zone,
      stop: s.stop,
      targets: s.targets,
      rr: s.execution_metrics?.rr_tp1 ?? null,
      final_score: s.final_score ?? null,
      execution_state: s.execution_state,
      context_fit,
      explain: explainSetup(s, ctxForFit),
    };
  });

  const setups_overview = {
    primary: primary
      ? {
          symbol: primary.symbol,
          type: primary.type,
          why_primary: "Điểm số cao nhất và phù hợp bối cảnh hiện tại.",
          when_to_trade: "Khi giá về vùng entry và có phản ứng rõ.",
          when_to_skip: translateReasonsVN(primary.execution_state?.reason),
        }
      : null,
    items,
  };

  /* ---------- GUIDANCE (NEW) ---------- */
  const guidance = {
    now: {
      intent:
        primary?.execution_state?.phase === "ready"
          ? "READY_TO_TRADE"
          : primary?.execution_state?.phase === "waiting"
          ? "WAIT"
          : "NO_TRADE",
      summary:
        primary?.execution_state?.phase === "ready"
          ? "Có thể vào lệnh nếu giá về đúng vùng."
          : primary?.execution_state?.phase === "waiting"
          ? "Đứng ngoài, chờ điều kiện rõ hơn."
          : "Không nên giao dịch lúc này.",
      do: [
        "Quan sát phản ứng giá tại vùng quan trọng.",
        "Ưu tiên lệnh chờ, không FOMO.",
      ],
      avoid: [
        "Không đuổi giá.",
        "Không tăng khối lượng khi rủi ro cao.",
      ],
    },
  };

  /* ---------- BACKWARD-COMPAT OUTPUT ---------- */
  return {
    version: "1.0",
    generated_at: snapshot?.generated_at ?? Date.now(),
    symbol: snapshot?.symbol ?? snapshot?.request?.symbol ?? "UNKNOWN",

    // CŨ
    headline: snapshot?.unified?.market_outlook_v1?.headline,
    action: snapshot?.unified?.market_outlook_v1?.action,
    horizons: snapshot?.unified?.market_outlook_v1?.horizons,
    flags: snapshot?.unified?.market_outlook_v1?.flags,
    flag_texts: snapshot?.unified?.market_outlook_v1?.flag_texts,

    // MỚI
    context,
    setups_overview,
    guidance,
  };
}
