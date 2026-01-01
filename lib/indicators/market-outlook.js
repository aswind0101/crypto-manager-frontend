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
// UI label dictionaries (NEW)
// ------------------------------
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

// ------------------------------
// NEW: regime strength fallback (for Viewer compatibility)
// Priority:
// 1) setups_v2.regime.strength
// 2) unified.scores.trend (if present, assume 0..1)
// 3) majority trend across TFs -> map to ~0.50 or ~0.30
// ------------------------------
function computeStrengthFallback(snapshot, regimeStrengthMaybe, tfFeatures) {
  if (Number.isFinite(regimeStrengthMaybe)) return clamp01(regimeStrengthMaybe);

  const sTrend = snapshot?.unified?.scores?.trend;
  if (Number.isFinite(sTrend)) return clamp01(sTrend);

  // Use TF trend agreement as a proxy
  const keys = ["15", "60", "240", "D"];
  const labels = keys.map((k) => pickTfFeat(tfFeatures, k)?.labels?.trend).filter(Boolean);
  if (!labels.length) return null;

  let bull = 0, bear = 0, range = 0;
  for (const l of labels) {
    if (l === "bull") bull++;
    else if (l === "bear") bear++;
    else range++;
  }

  // Strong if 3-4 agree, medium if 2 agree, weak otherwise
  const maxAgree = Math.max(bull, bear, range);
  if (maxAgree >= 3) return 0.65;
  if (maxAgree === 2) return 0.45;
  return 0.30;
}

// ------------------------------
// NEW: flag chip texts for UI (retail-friendly)
// ------------------------------
export const FLAG_VN = {
  data_partial: { text: "Thiếu dữ liệu", tone: "warn" },
  data_unavailable: { text: "Không có dữ liệu", tone: "bad" },

  funding_extreme_pos: { text: "Funding cao", tone: "warn" },
  funding_extreme_neg: { text: "Funding thấp", tone: "warn" },
  funding_divergent_extremes: { text: "Funding lệch", tone: "warn" },

  leverage_risk_on: { text: "Đòn bẩy cao", tone: "warn" },
  leverage_risk_off: { text: "Đòn bẩy giảm", tone: "neutral" },

  liquidation_pulse_high: { text: "Dễ giật mạnh", tone: "warn" },
  liquidation_pulse_mid: { text: "Rung lắc", tone: "neutral" },
  liquidation_pulse_low: { text: "Ít quét", tone: "good" },

  orderflow_buying: { text: "Dòng tiền mua", tone: "good" },
  orderflow_selling: { text: "Dòng tiền bán", tone: "bad" },
  orderflow_neutral: { text: "Dòng tiền cân bằng", tone: "neutral" },
  orderflow_missing: { text: "Thiếu orderflow", tone: "warn" },

  volatility_unknown: { text: "Chưa rõ độ rung", tone: "neutral" },
  vol_low_chop_risk: { text: "Dễ đi ngang", tone: "neutral" },
  vol_mid_high: { text: "Biên lớn", tone: "warn" },
  vol_high_whipsaw_risk: { text: "Giật mạnh", tone: "warn" },
  vol_normal: { text: "Biên bình thường", tone: "good" },
};

function flagsToTexts(flags) {
  const out = [];
  for (const f of uniq(flags)) {
    const meta = FLAG_VN[f];
    if (meta?.text) out.push({ key: f, text: meta.text, tone: meta.tone || "neutral" });
    else out.push({ key: f, text: String(f), tone: "neutral" });
  }
  return out;
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
// SETUP-CENTRIC EXTENSIONS (v1.x, backward compatible)
// Adds: context, setups_overview, guidance
// ------------------------------
function getRefPrice(snapshot) {
  // Prefer mark price if available
  const a = snapshot?.per_exchange?.bybit?.ticker;
  const b = snapshot?.per_exchange?.binance?.ticker;
  const u = snapshot?.unified?.per_exchange?.bybit?.ticker || null;
  const v = snapshot?.unified?.per_exchange?.binance?.ticker || null;

  const mark = safeNum(a?.mark ?? u?.mark);
  const last = safeNum(a?.last ?? u?.last);
  const idx = safeNum(a?.index ?? u?.index);

  const mark2 = safeNum(b?.mark ?? v?.mark);
  const last2 = safeNum(b?.last ?? v?.last);

  return mark ?? last ?? idx ?? mark2 ?? last2 ?? null;
}

function pct(x) {
  if (!Number.isFinite(x)) return null;
  return x;
}

function biasToTrendLabel(biasStr) {
  const b = String(biasStr || "").toLowerCase();
  if (b === "long") return "bull";
  if (b === "short") return "bear";
  return "range";
}

function detectSetupPhase(setup) {
  const p = setup?.execution_state?.phase;
  if (p) return p;
  // fallback if only eligibility exists
  if (setup?.eligibility?.status) return String(setup.eligibility.status);
  return "unknown";
}

function getScore(setup) {
  const s = safeNum(setup?.final_score);
  if (Number.isFinite(s)) return s;
  const s2 = safeNum(setup?.scores?.final_score);
  if (Number.isFinite(s2)) return s2;
  const c = safeNum(setup?.confidence);
  return Number.isFinite(c) ? c : null;
}

function getRR(setup) {
  const rr1 = safeNum(setup?.execution_metrics?.rr_tp1);
  if (Number.isFinite(rr1)) return rr1;
  const rr2 = safeNum(setup?.scores?.rr_tp1);
  if (Number.isFinite(rr2)) return rr2;
  const rr3 = safeNum(setup?.rr_estimate_tp1);
  return Number.isFinite(rr3) ? rr3 : null;
}

function computeDistanceToEntryPct(setup, refPx) {
  const z = Array.isArray(setup?.entry_zone) ? setup.entry_zone : null;
  if (!z || z.length !== 2 || !Number.isFinite(refPx) || refPx <= 0) return null;
  const lo = Math.min(z[0], z[1]);
  const hi = Math.max(z[0], z[1]);
  if (refPx >= lo && refPx <= hi) return 0;
  const dist = refPx < lo ? (lo - refPx) : (refPx - hi);
  return dist / refPx;
}

function computeStopDistancePct(setup, refPx) {
  const stop = safeNum(setup?.stop ?? setup?.invalidation);
  if (!Number.isFinite(stop) || !Number.isFinite(refPx) || refPx <= 0) return null;
  return Math.abs(refPx - stop) / refPx;
}

function computeContextFit(setup, ctx) {
  // ctx: { trendLabel, orderflowFlag, liqLevel, volFlag }
  let s = 0.50;
  const biasLabel = biasToTrendLabel(setup?.bias);
  if (ctx?.trendLabel) {
    if ((biasLabel === "bull" && ctx.trendLabel === "bull") || (biasLabel === "bear" && ctx.trendLabel === "bear")) s += 0.22;
    else if (ctx.trendLabel === "range") s += 0.04;
    else s -= 0.12;
  }

  if (ctx?.orderflowFlag) {
    if (ctx.orderflowFlag === "orderflow_buying" && biasLabel === "bull") s += 0.10;
    if (ctx.orderflowFlag === "orderflow_selling" && biasLabel === "bear") s += 0.10;
    if ((ctx.orderflowFlag === "orderflow_buying" && biasLabel === "bear") || (ctx.orderflowFlag === "orderflow_selling" && biasLabel === "bull")) s -= 0.08;
  }

  if (ctx?.liqLevel === "high") s -= 0.10;
  if (ctx?.volFlag === "vol_high_whipsaw_risk") s -= 0.10;
  if (ctx?.volFlag === "vol_low_chop_risk") s -= 0.04;

  // execution_state impact
  const phase = detectSetupPhase(setup);
  if (phase === "ready") s += 0.10;
  if (phase === "waiting") s += 0.02;
  if (phase === "missed") s -= 0.12;
  if (phase === "invalidated") s -= 0.18;

  // RR & score sanity (small nudges)
  const rr = getRR(setup);
  if (Number.isFinite(rr)) {
    if (rr >= 1.8) s += 0.06;
    else if (rr >= 1.2) s += 0.03;
    else if (rr < 0.9) s -= 0.05;
  }
  const sc = getScore(setup);
  if (Number.isFinite(sc)) {
    if (sc >= 0.8) s += 0.06;
    else if (sc >= 0.65) s += 0.03;
    else if (sc < 0.5) s -= 0.04;
  }

  return clamp01(s);
}

function buildSetupExplain(setup, ctx, refPx, execSentencesForSetup) {
  const why = [];
  const entry = [];
  const invalid = [];
  const mgmt = [];

  const typeLabel = TYPE_VN[setup?.type] || setup?.type || "setup";
  const tfLabel = TF_VN[String(setup?.timeframe)] || String(setup?.timeframe || "");
  const bias = setup?.bias || "—";

  why.push(`${typeLabel} • ${bias} • ${tfLabel}.`);
  if (setup?.trigger) why.push(`Trigger: ${setup.trigger}.`);

  if (ctx?.trendLabel) {
    const t = trendLabelToVN(ctx.trendLabel);
    why.push(`Bối cảnh: xu hướng khung chính đang ${t.tone}.`);
  }
  if (ctx?.orderflowText) why.push(ctx.orderflowText);
  if (ctx?.liqText) why.push(ctx.liqText);

  const dist = computeDistanceToEntryPct(setup, refPx);
  if (dist === 0) entry.push("Giá đang nằm trong vùng entry: có thể canh vào theo kế hoạch.");
  else if (Number.isFinite(dist)) entry.push(`Giá đang cách vùng entry ~${Math.round(dist * 1000) / 10}%. Không đuổi, ưu tiên chờ hồi/pullback.`);
  else entry.push("Ưu tiên chờ giá về vùng entry, không đuổi.");

  const orderType = setup?.execution_state?.order?.type;
  if (orderType === "LIMIT") entry.push("Ưu tiên đặt lệnh chờ (LIMIT) trong vùng entry.");
  else if (orderType === "MARKET") entry.push("Chỉ vào MARKET khi giá rất gần entry và có xác nhận rõ.");
  else entry.push("Nếu chưa có xác nhận rõ, đứng ngoài.");

  if (ctx?.volText) entry.push(ctx.volText);

  const stop = safeNum(setup?.stop ?? setup?.invalidation);
  if (Number.isFinite(stop)) invalid.push(`Kèo hỏng nếu giá chạm/vượt stop ${stop}.`);
  if (setup?.execution_state?.phase === "invalidated") invalid.push("Trạng thái: kèo đã hỏng, không vào lại.");

  const sd = computeStopDistancePct(setup, refPx);
  if (Number.isFinite(sd) && sd < 0.004) mgmt.push("Stop khá sát: giảm khối lượng để tránh bị quét ngẫu nhiên.");
  mgmt.push("Chốt 1 phần tại TP1, dời SL về hòa vốn nếu thị trường đi đúng hướng.");
  mgmt.push("Nếu giá đi ngược nhanh và phá cấu trúc, thoát theo kỷ luật.");

  if (Array.isArray(execSentencesForSetup) && execSentencesForSetup.length) {
    // Put the most actionable sentence into entry/avoid
    entry.push(execSentencesForSetup[0]);
  }

  return {
    why_this_setup: uniq(why),
    entry_tactics: uniq(entry),
    invalidation: uniq(invalid),
    management: uniq(mgmt),
  };
}

function bucketKeyForSetup(setup) {
  const tf = String(setup?.timeframe ?? "");
  if (tf === "5" || tf === "15" || tf === "60") return "h0_4h";
  if (tf === "240") return "h1_3d";
  if (tf === "D") return "h2_2w";
  // fallback: treat unknown as short horizon
  return "h0_4h";
}

function rankSetupsForBucket(items) {
  const arr = (items || []).slice();
  arr.sort((a, b) => {
    const aScore = (Number.isFinite(a.final_score) ? a.final_score : 0) * 0.65 + (Number.isFinite(a.context_fit) ? a.context_fit : 0) * 0.35;
    const bScore = (Number.isFinite(b.final_score) ? b.final_score : 0) * 0.65 + (Number.isFinite(b.context_fit) ? b.context_fit : 0) * 0.35;
    if (bScore !== aScore) return bScore - aScore;
    const ar = Number.isFinite(a.rr_tp1) ? a.rr_tp1 : -1;
    const br = Number.isFinite(b.rr_tp1) ? b.rr_tp1 : -1;
    return br - ar;
  });
  return arr;
}

function intentFromPrimary(primaryExec) {
  const phase = primaryExec?.phase || "waiting";
  const rs = Array.isArray(primaryExec?.reason) ? primaryExec.reason : [];

  // NO_TRADE reasons
  if (phase === "missed") {
    if (rs.includes("price_too_far_from_entry_zone") || rs.includes("avoid_chasing")) return "NO_TRADE_AVOID_CHASING";
    if (rs.includes("ref_price_missing")) return "NO_TRADE_MISSING_PRICE";
    return "NO_TRADE";
  }
  if (phase === "invalidated") return "INVALIDATED";
  if (phase === "ready") return "READY";
  // waiting
  if (rs.includes("waiting_pullback_to_zone")) return "WAIT_PULLBACK";
  if (rs.includes("waiting_trigger") || rs.includes("waiting_reversal_confirmation")) return "WAIT_CONFIRMATION";
  return "WAIT";
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

  // NEW: strength fallback
  const strengthRaw = regime?.strength ?? null;
  const strength = computeStrengthFallback(snapshot, strengthRaw, tfFeatures);

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
      // NEW: if no primary, avoid saying "Kèo chính"
      if (primary) out.push(`Kèo chính: ${status.label}.`);
      else out.push("Chưa có kèo rõ ràng, ưu tiên đứng ngoài.");

      if (primary && exec?.order?.type === "LIMIT") out.push("Ưu tiên đặt lệnh chờ trong vùng, không đuổi giá.");
      else if (primary && exec?.order?.type === "MARKET") out.push("Chỉ vào khi giá rất gần điểm vào, tránh FOMO.");
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
        // NEW: convenient UI labels
        setup_type_label: TYPE_VN[primary?.type] || primary?.type || null,
        tf_label: TF_VN[String(primary?.timeframe)] || String(primary?.timeframe || ""),
      }
    : {
        status: "Chưa có kèo",
        order_type: null,
        order_price: null,
        summary: ["Chưa tìm được kèo đủ điều kiện."],
        setup_type_label: null,
        tf_label: null,
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

  // NEW: add volatility chip flags (use the same volatilityRisk function)
  const v0 = volatilityRiskVN(atrPct60 ?? atrPct15);
  if (v0?.flag) flags.push(v0.flag);


  const flagsUniq = uniq(flags);

  // ------------------------------
  // NEW: setup-centric context blocks (backward compatible)
  // ------------------------------
  const ref_price = getRefPrice(snapshot);

  const trend_by_tf = {};
  for (const k of ["5","15","60","240","D"]) {
    const t = pickTfFeat(tfFeatures, k);
    trend_by_tf[k] = t ? (t.labels || null) : null;
  }

  const context = {
    regime: regime ? {
      label: regime.label ?? null,
      composite: safeNum(regime.composite),
      strength: Number.isFinite(strength) ? strength : null,
      per_tf: regime.per_tf ?? null,
    } : null,
    ref_price,
    trend_by_tf,
    volatility_by_tf: anchor?.volatility?.atr_pct || {},
    derivatives: {
      funding_flag: fundSum.flag || null,
      funding_text: fundSum.text || null,
      leverage_flag: levSum.flag || null,
      leverage_text: levSum.text || null,
      liquidation_flag: liqSum.flag || null,
      liquidation_level: liqSum.level || "none",
      liquidation_text: liqSum.text || null,
    },
    orderflow: {
      flag: ofSum.flag || null,
      text: ofSum.text || null,
    },
    data_quality: qualityToVN(quality),
  };

  // Build a unified list of setups (primary + candidates)
  const listTop = Array.isArray(setups?.top_candidates) ? setups.top_candidates : [];
  const listAll = Array.isArray(setups?.candidates_all) ? setups.candidates_all : [];
  const merged = [];
  if (primary) merged.push(primary);
  for (const s of listTop) merged.push(s);
  for (const s of listAll) merged.push(s);

  // Normalize + enrich setups for UI
  const ctxShort = {
    trendLabel: biasH0,
    orderflowFlag: ofSum.flag,
    orderflowText: ofSum.text,
    liqLevel: liqSum.level,
    liqText: liqSum.text,
    volFlag: v0?.flag,
    volText: v0?.text,
  };
  const ctxMid = {
    trendLabel: biasH1,
    orderflowFlag: ofSum.flag,
    orderflowText: ofSum.text,
    liqLevel: liqSum.level,
    liqText: liqSum.text,
    volFlag: volatilityRiskVN(atrPct240)?.flag,
    volText: volatilityRiskVN(atrPct240)?.text,
  };
  const ctxLong = {
    trendLabel: biasH2,
    orderflowFlag: ofSum.flag,
    orderflowText: ofSum.text,
    liqLevel: liqSum.level,
    liqText: liqSum.text,
    volFlag: volatilityRiskVN(atrPctD)?.flag,
    volText: volatilityRiskVN(atrPctD)?.text,
  };

  const setupItemsRaw = [];
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i];
    if (!s || !s.symbol) continue;

    const bucket = bucketKeyForSetup(s);
    const ctx = bucket === "h0_4h" ? ctxShort : bucket === "h1_3d" ? ctxMid : ctxLong;

    const phase = detectSetupPhase(s);
    const reasonsVN = translateReasonsVN(s?.execution_state?.reason);
    const final_score = getScore(s);
    const rr_tp1 = getRR(s);

    const dist_entry_pct = computeDistanceToEntryPct(s, ref_price);
    const stop_dist_pct = computeStopDistancePct(s, ref_price);

    const context_fit = computeContextFit(s, ctx);

    const id = `${String(s.symbol)}_${String(s.type || "setup")}_${String(s.bias || "")}_${String(s.timeframe || "")}_${i}`;

    setupItemsRaw.push({
      id,
      bucket,
      symbol: s.symbol,
      type: s.type || null,
      type_label: TYPE_VN[s.type] || s.type || null,
      bias: s.bias || null,
      timeframe: String(s.timeframe || ""),
      tf_label: TF_VN[String(s.timeframe)] || String(s.timeframe || ""),
      trigger: s.trigger || null,

      entry_zone: Array.isArray(s.entry_zone) ? s.entry_zone : null,
      entry_preferred: safeNum(s.entry_preferred ?? s.entry) ?? null,
      stop: safeNum(s.stop ?? s.invalidation) ?? null,
      invalidation: safeNum(s.invalidation ?? s.stop) ?? null,
      targets: s.targets || null,

      execution_state: s.execution_state || null,
      phase,
      reasons_vn: reasonsVN,

      final_score,
      rr_tp1,

      distance_to_entry_pct: dist_entry_pct,
      stop_distance_pct: stop_dist_pct,

      context_fit,

      explain: buildSetupExplain(s, ctx, ref_price, reasonsVN),
    });
  }

  // Deduplicate by id (best-effort): keep first occurrence
  const seenIds = new Set();
  const setupItems = [];
  for (const it of setupItemsRaw) {
    if (seenIds.has(it.id)) continue;
    seenIds.add(it.id);
    setupItems.push(it);
  }

  // Buckets for horizons (focus / avoid)
  const by_horizon = {
    h0_4h: { focus: [], avoid: [], note: "Ưu tiên LIMIT trong vùng entry, không đuổi giá." },
    h1_3d: { focus: [], avoid: [], note: "Ưu tiên kèo theo xu hướng 4H/D, tránh vào lúc giật mạnh." },
    h2_2w: { focus: [], avoid: [], note: "Ưu tiên theo xu hướng ngày, hạn chế bắt đáy/đỉnh." },
  };

  const bucketItems = {
    h0_4h: [],
    h1_3d: [],
    h2_2w: [],
  };
  for (const it of setupItems) {
    if (bucketItems[it.bucket]) bucketItems[it.bucket].push(it);
  }

  for (const bk of ["h0_4h","h1_3d","h2_2w"]) {
    const ranked = rankSetupsForBucket(bucketItems[bk]);

    const avoid = [];
    const focus = [];
    for (const it of ranked) {
      const rs = Array.isArray(it.execution_state?.reason) ? it.execution_state.reason : [];
      const badReason = rs.includes("price_beyond_invalidation") || rs.includes("price_too_far_from_entry_zone") || rs.includes("avoid_chasing");
      const badPhase = it.phase === "invalidated" || it.phase === "missed";
      if (badPhase || badReason) avoid.push(it.id);
      else focus.push(it.id);
    }

    by_horizon[bk].focus = focus.slice(0, 3);
    by_horizon[bk].avoid = avoid.slice(0, 3);
  }

  const primary_overview = primary ? {
    symbol: primary.symbol,
    type: primary.type || null,
    type_label: TYPE_VN[primary.type] || primary.type || null,
    bias: primary.bias || null,
    timeframe: String(primary.timeframe || ""),
    tf_label: TF_VN[String(primary.timeframe)] || String(primary.timeframe || ""),
    status: status.label,
    order_type: exec?.order?.type || null,
    summary: execSentences,
    key_points: uniq([
      `Trạng thái: ${status.label}.`,
      ...(execSentences || []),
      ref_price ? `Giá tham chiếu: ${ref_price}.` : null,
    ]),
  } : null;

  const setups_overview = {
    primary: primary_overview,
    by_horizon,
    items: setupItems,
  };

  // Guidance for retail: do/avoid right now
  const intent = intentFromPrimary(exec);
  const guidance = {
    now: {
      intent,
      status: status.label,
      summary: (() => {
        if (intent === "READY") return "Giá đang đáp ứng điều kiện vào lệnh. Ưu tiên vào đúng vùng và quản trị rủi ro chặt.";
        if (intent === "WAIT_PULLBACK") return "Đứng ngoài, chờ giá hồi về vùng entry. Tuyệt đối không đuổi.";
        if (intent === "WAIT_CONFIRMATION") return "Chưa đủ xác nhận. Theo dõi thêm trước khi vào.";
        if (intent === "NO_TRADE_AVOID_CHASING") return "Giá đã chạy xa vùng entry. Bỏ kèo để tránh FOMO.";
        if (intent === "INVALIDATED") return "Kèo đã hỏng. Không vào lại theo kèo này.";
        if (intent === "NO_TRADE_MISSING_PRICE") return "Thiếu giá tham chiếu. Hạn chế giao dịch.";
        if (intent.startsWith("NO_TRADE")) return "Ưu tiên đứng ngoài để bảo toàn vốn.";
        return "Theo dõi thêm trước khi hành động.";
      })(),
      do: uniq([
        intent === "READY" ? "Chia lệnh: vào từng phần trong entry zone." : "Canh vùng entry, chờ phản ứng rõ.",
        (exec?.order?.type === "LIMIT") ? "Ưu tiên đặt LIMIT trong vùng entry." : "Ưu tiên LIMIT; chỉ MARKET khi rất gần entry.",
        "Giảm khối lượng nếu biên dao động lớn.",
        liqSum.level === "high" ? "Nếu có sóng quét mạnh: chỉ vào khi có xác nhận, tránh bị giật." : null,
      ]),
      avoid: uniq([
        (intent === "WAIT_PULLBACK" || intent === "NO_TRADE_AVOID_CHASING") ? "Không đuổi giá / không FOMO." : "Không vào khi chưa rõ xu hướng.",
        v0?.flag === "vol_high_whipsaw_risk" ? "Tránh vào lệnh lớn khi thị trường đang giật mạnh." : null,
        fundSum.flag ? "Cẩn thận squeeze do funding/đòn bẩy." : null,
      ]),
      reasons_vn: execSentences,
    },
  };

  return {
    version: "1.0",
    generated_at: snapshot?.generated_at ?? Date.now(),
    symbol: snapshot?.symbol ?? snapshot?.request?.symbol ?? "UNKNOWN",

    // Existing (backward compatible)
    headline,
    action,
    horizons: [h0, h1, h2],
    flags: flagsUniq,
    flag_texts: flagsToTexts(flagsUniq),

    // NEW (setup-centric)
    context,
    setups_overview,
    guidance,
  };
}
