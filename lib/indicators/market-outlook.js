// lib/indicators/market-outlook.js
// Market Outlook v1 (Retail-ready, deterministic, no-AI)
// Exports: buildMarketOutlookV1(snapshot)
// Notes:
// - Produces ready-to-render VN sentences for retail UI
// - Safe fallbacks for missing/partial data
// - No external deps

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function safeNum(x) { return Number.isFinite(x) ? x : null; }

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

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

// ------------------------------
// Reason dictionary (execution_state.reason -> VN)
// Keep short, natural, non-academic
// ------------------------------
export const REASON_VN = {
  // READY
  inside_entry_zone: "Giá đã vào đúng vùng, có thể đặt lệnh.",
  reversal_confirmed: "Có tín hiệu đảo chiều, ưu tiên kèo này.",

  // WAITING
  waiting_pullback_to_zone: "Chờ giá hồi về vùng vào lệnh, không đuổi.",
  waiting_trigger: "Chưa đủ dấu hiệu xác nhận, tạm đứng ngoài.",
  waiting_reversal_confirmation: "Chờ tín hiệu xác nhận rồi mới vào.",

  // NO-TRADE / SAFETY
  price_too_far_from_entry_zone: "Giá chạy xa vùng vào, bỏ kèo để tránh FOMO.",
  price_beyond_invalidation: "Giá đã vượt điểm hỏng kèo, không vào nữa.",
  not_tradable: "Kèo này không đẹp, nên bỏ để tránh rủi ro.",
  avoid_chasing: "Không đuổi giá lúc này.",
  rr_is_modest: "Lợi nhuận kỳ vọng không cao, cân nhắc giảm khối lượng.",
  ref_price_missing: "Thiếu giá tham chiếu, không thể ra quyết định vào lệnh.",
};

export function translateReasonsVN(reasons) {
  const rs = Array.isArray(reasons) ? reasons : [];
  const out = [];
  for (const r of rs) {
    if (REASON_VN[r]) out.push(REASON_VN[r]);
  }
  if (!out.length && rs.length) out.push("Đang chờ điều kiện phù hợp hơn.");
  if (!out.length) out.push("Theo dõi thêm trước khi hành động.");
  return uniq(out);
}

// ------------------------------
// Derivatives summary
// ------------------------------
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

// ------------------------------
// Liquidation pulse summary
// ------------------------------
function liquidationPulseVN(liqFeatures) {
  const observed = !!liqFeatures?.observed;
  const inten = safeNum(liqFeatures?.intensity_15m);
  const bias = safeNum(liqFeatures?.bias);

  if (!observed) return { flag: null, text: null, level: "none" };

  let level = "low";
  if (Number.isFinite(inten)) {
    if (inten > 0.15) level = "high";
    else if (inten > 0.05) level = "mid";
    else level = "low";
  } else {
    level = "mid";
  }

  let biasText = null;
  if (Number.isFinite(bias)) {
    if (bias > 0.25) biasText = "Nhiều lệnh Short bị quét, lực đẩy lên đang mạnh.";
    else if (bias < -0.25) biasText = "Nhiều lệnh Long bị quét, lực đạp xuống đang mạnh.";
    else biasText = "Lực quét hai phía tương đối cân bằng.";
  }

  const baseText =
    level === "high"
      ? "Đang có sóng quét mạnh, giá dễ giật nhanh."
      : level === "mid"
      ? "Có quét nhẹ, giá có thể rung lắc."
      : "Quét ít, giá thường chạy đều hơn.";

  return {
    flag: level === "high" ? "liquidation_pulse_high" : level === "mid" ? "liquidation_pulse_mid" : "liquidation_pulse_low",
    text: biasText ? `${baseText} ${biasText}` : baseText,
    level,
  };
}

// ------------------------------
// Orderflow summary (retail wording)
// ------------------------------
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

// ------------------------------
// Volatility risk summary (retail wording)
// atr_pct thresholds aligned with your v2 gates: <0.3% low, >3% high
// ------------------------------
function volatilityRiskVN(atrPct) {
  const x = safeNum(atrPct);
  if (!Number.isFinite(x)) return { flag: "volatility_unknown", text: "Chưa đủ dữ liệu để đánh giá độ rung." };

  if (x < 0.003) return { flag: "vol_low_chop_risk", text: "Biên dao động thấp, dễ đi ngang và quét nhẹ." };
  if (x > 0.030) return { flag: "vol_high_whipsaw_risk", text: "Biên dao động cao, giá dễ giật mạnh." };
  if (x > 0.015) return { flag: "vol_mid_high", text: "Biên dao động đang khá lớn, nên vào lệnh chặt chẽ." };
  return { flag: "vol_normal", text: "Biên dao động bình thường." };
}

// ------------------------------
// Execution status summary (retail wording)
// ------------------------------
function readinessToVN(execState) {
  const phase = execState?.phase || "waiting";
  if (phase === "ready") return { label: "Vào được", color: "good" };
  if (phase === "waiting") return { label: "Đang chờ", color: "neutral" };
  if (phase === "missed") return { label: "Bỏ kèo", color: "bad" };
  if (phase === "invalidated") return { label: "Kèo hỏng", color: "bad" };
  return { label: "Đang chờ", color: "neutral" };
}

// ------------------------------
// TF helpers
// ------------------------------
function pickTfFeat(tfFeatures, tfKey) {
  const t = tfFeatures?.[tfKey];
  return t && t.last ? t : null;
}

function horizonBiasFromTfs(tfFeatures, keys) {
  const labels = keys
    .map((k) => pickTfFeat(tfFeatures, k)?.labels?.trend)
    .filter(Boolean);

  if (!labels.length) return "range";

  let bull = 0, bear = 0, range = 0;
  for (const l of labels) {
    if (l === "bull") bull++;
    else if (l === "bear") bear++;
    else range++;
  }

  if (bull > bear && bull >= 1) return "bull";
  if (bear > bull && bear >= 1) return "bear";
  return "range";
}

function buildRetailOutlookBlock({ title, horizonKey, tfBiasLabel, strength, drivers, risks, playbook, confidenceScore }) {
  return {
    key: horizonKey,
    title,
    bias: trendLabelToVN(tfBiasLabel).bias,
    clarity: strengthToVN(strength),
    confidence: clamp01(confidenceScore),
    drivers: uniq(drivers),
    risks: uniq(risks),
    playbook: uniq(playbook),
  };
}

// ------------------------------
// Main builder
// ------------------------------
export function buildMarketOutlookV1(snapshot) {
  const tfFeatures = snapshot?.unified?.features?.timeframes || {};
  const deriv = snapshot?.unified?.features?.derivatives || {};
  const fundingLabels = deriv?.funding_labels || {};
  const derivSynth = deriv?.derivatives_synthesis || {};
  const liq = deriv?.liquidation_features || {};
  const of = snapshot?.unified?.features?.orderflow || {};

  const quality = snapshot?.unified?.data_quality || "unknown";
  const setups = snapshot?.unified?.setups_v2 || {};
  const regime = setups?.regime || null;

  const anchor = snapshot?.unified?.anchor_layer;
  const atrPct15 = anchor?.volatility?.atr_pct?.["15"] ?? null;
  const atrPct60 = anchor?.volatility?.atr_pct?.["60"] ?? null;
  const atrPct240 = anchor?.volatility?.atr_pct?.["240"] ?? null;
  const atrPctD = anchor?.volatility?.atr_pct?.["D"] ?? null;

  const fundSum = fundingSummaryVN(fundingLabels);
  const levSum = leverageRegimeVN(derivSynth?.leverage_regime);
  const liqSum = liquidationPulseVN(liq);
  const ofSum = orderflowVN(of);

  const primary = setups?.primary || null;
  const exec = primary?.execution_state || null;
  const status = readinessToVN(exec);
  const execSentences = translateReasonsVN(exec?.reason);

  const biasH0 = horizonBiasFromTfs(tfFeatures, ["15", "60"]);
  const biasH1 = horizonBiasFromTfs(tfFeatures, ["240", "D"]);
  const biasH2 = horizonBiasFromTfs(tfFeatures, ["D"]);

  const strength = regime?.strength ?? null;

  // Deterministic confidence (NOT probability)
  const baseQ = quality === "ok" ? 0.70 : quality === "partial" ? 0.55 : 0.40;
  const regBoost = Number.isFinite(strength) ? 0.20 * clamp01(strength) : 0.0;
  const liqBoost = liq?.observed ? (liqSum.level === "high" ? 0.08 : liqSum.level === "mid" ? 0.04 : 0.02) : 0.0;
  const ofBoost = (ofSum.flag === "orderflow_missing") ? 0.0 : 0.05;
  const confBase = clamp01(baseQ + regBoost + liqBoost + ofBoost);

  function commonRisksFor(atrPct) {
    const out = [];
    const vol = volatilityRiskVN(atrPct);
    if (vol?.text) out.push(vol.text);

    if (quality !== "ok") out.push(quality === "partial" ? "Thiếu một phần dữ liệu, nên giảm khối lượng." : "Thiếu dữ liệu, hạn chế vào lệnh.");

    if (fundSum.text) out.push(fundSum.text);
    if (levSum.text) out.push(levSum.text);

    // liquidation risk only if observed and meaningful
    if (liqSum.text && (liqSum.level === "high" || liqSum.level === "mid")) out.push(liqSum.text);

    return uniq(out);
  }

  function driversShort() {
    const out = [];
    const t15 = pickTfFeat(tfFeatures, "15")?.labels || {};
    const t60 = pickTfFeat(tfFeatures, "60")?.labels || {};
    if (t15.trend) out.push(`Ngắn hạn: thị trường đang ${trendLabelToVN(t15.trend).tone}.`);
    if (t60.trend) out.push(`Khung 1 giờ: xu hướng ${trendLabelToVN(t60.trend).tone}.`);
    if (ofSum.text) out.push(ofSum.text);
    if (liq?.observed && liqSum.text) out.push(liqSum.text);
    return uniq(out);
  }

  function driversMid() {
    const out = [];
    const t240 = pickTfFeat(tfFeatures, "240")?.labels || {};
    const tD = pickTfFeat(tfFeatures, "D")?.labels || {};
    if (t240.trend) out.push(`Vài ngày: xu hướng đang ${trendLabelToVN(t240.trend).tone}.`);
    if (tD.trend) out.push(`Khung ngày: xu hướng ${trendLabelToVN(tD.trend).tone}.`);
    if (levSum.text) out.push(levSum.text);
    if (fundSum.text) out.push(fundSum.text);
    return uniq(out);
  }

  function driversLong() {
    const out = [];
    const tD = pickTfFeat(tfFeatures, "D")?.labels || {};
    if (tD.trend) out.push(`Xu hướng chính: ${trendLabelToVN(tD.trend).bias}.`);
    if (Number.isFinite(strength)) out.push(`Độ rõ xu hướng: ${strengthToVN(strength)}.`);
    if (fundSum.text) out.push(fundSum.text);
    return uniq(out);
  }

  function playbookFor(hKey) {
    const out = [];
    if (hKey === "h0_4h") {
      out.push(`Kèo chính: ${status.label}.`);
      if (exec?.order?.type === "LIMIT") out.push("Ưu tiên đặt lệnh chờ trong vùng, không đuổi giá.");
      else if (exec?.order?.type === "MARKET") out.push("Chỉ vào khi giá rất gần điểm vào, tránh FOMO.");
      else out.push("Chờ đúng vùng/đúng tín hiệu rồi mới vào.");
      return uniq(out.concat(execSentences));
    }
    if (hKey === "h1_3d") {
      out.push("Ưu tiên kèo có stop rõ ràng và RR hợp lý.");
      out.push("Tránh vào lệnh khi thị trường giật mạnh liên tục.");
      return uniq(out);
    }
    out.push("Ưu tiên đi theo xu hướng chính, hạn chế bắt đáy/đỉnh.");
    out.push("Nếu xu hướng yếu, giảm khối lượng và chờ điểm đẹp.");
    return uniq(out);
  }

  const headlineBias = regime?.label
    ? (regime.label.startsWith("bull") ? "Tăng" : regime.label.startsWith("bear") ? "Giảm" : "Đi ngang")
    : trendLabelToVN(biasH1).bias;

  const headline = {
    market_position: `Thị trường đang: ${headlineBias}.`,
    trend_clarity: `Độ rõ xu hướng: ${strengthToVN(strength)}.`,
    data_quality: `Dữ liệu: ${qualityToVN(quality)}.`,
    quick_risk: (() => {
      const v = volatilityRiskVN(atrPct60 ?? atrPct15);
      if (v.flag === "vol_high_whipsaw_risk") return "Rủi ro: Giá dễ giật mạnh.";
      if (v.flag === "vol_low_chop_risk") return "Rủi ro: Dễ đi ngang và rung lắc.";
      if (quality !== "ok") return "Rủi ro: Thiếu dữ liệu, nên thận trọng.";
      if (liqSum.level === "high") return "Rủi ro: Có sóng quét mạnh, dễ biến động.";
      return "Rủi ro: Bình thường.";
    })(),
  };

  const action = primary
    ? {
        status: status.label,
        order_type: exec?.order?.type || null,
        order_price: exec?.order?.price ?? null,
        summary: execSentences,
      }
    : {
        status: "Chưa có kèo",
        order_type: null,
        order_price: null,
        summary: ["Chưa tìm được kèo đủ điều kiện."],
      };

  const h0 = buildRetailOutlookBlock({
    title: "30 phút – 4 giờ tới",
    horizonKey: "h0_4h",
    tfBiasLabel: biasH0,
    strength,
    drivers: driversShort(),
    risks: commonRisksFor(atrPct60 ?? atrPct15),
    playbook: playbookFor("h0_4h"),
    confidenceScore: confBase,
  });

  const h1 = buildRetailOutlookBlock({
    title: "1 – 3 ngày tới",
    horizonKey: "h1_3d",
    tfBiasLabel: biasH1,
    strength,
    drivers: driversMid(),
    risks: commonRisksFor(atrPct240),
    playbook: playbookFor("h1_3d"),
    confidenceScore: clamp01(confBase - 0.05),
  });

  const h2 = buildRetailOutlookBlock({
    title: "1 – 2 tuần tới",
    horizonKey: "h1_2w",
    tfBiasLabel: biasH2,
    strength,
    drivers: driversLong(),
    risks: commonRisksFor(atrPctD),
    playbook: playbookFor("h1_2w"),
    confidenceScore: clamp01(confBase - 0.10),
  });

  const flags = [];
  if (quality !== "ok") flags.push(quality === "partial" ? "data_partial" : "data_unavailable");
  if (fundSum.flag) flags.push(fundSum.flag);
  if (levSum.flag) flags.push(levSum.flag);
  if (liqSum.flag) flags.push(liqSum.flag);
  if (ofSum.flag) flags.push(ofSum.flag);

  return {
    version: "1.0",
    generated_at: snapshot?.generated_at ?? Date.now(),
    symbol: snapshot?.symbol ?? snapshot?.request?.symbol ?? "UNKNOWN",
    headline,
    action,
    horizons: [h0, h1, h2],
    flags: uniq(flags),
  };
}
