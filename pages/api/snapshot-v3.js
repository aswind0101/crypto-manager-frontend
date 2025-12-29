// pages/api/snapshot-v3.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { symbols, mode, anchorRef } = req.body || {};

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ ok: false, error: "symbols must be a non-empty array" });
    }

    const m = String(mode || "FULL").toUpperCase();

    // IMPORTANT: chỉnh path này theo project của bạn
    // Bạn đã upload file snapshot-v3.js; hãy đặt vào /lib/snapshot-v3.js để import ổn định.
    const mod = await import("../../lib/snapshot-v3.js");

    let payload = null;

    if (m === "FULL") {
      payload = await mod.buildFullSnapshotV3(symbols);
    } else if (m === "COMPACT") {
      payload = await mod.buildFullSnapshotV3Compact(symbols);
    } else if (m === "ENTRY_LTF") {
      payload = await mod.buildEntryLtfSnapshotV3(symbols, anchorRef || null);
    } else {
      return res.status(400).json({ ok: false, error: "Invalid mode. Use FULL | COMPACT | ENTRY_LTF" });
    }

    return res.status(200).json({
      ok: true,
      mode: m,
      generated_at: payload?.generated_at || Date.now(),
      snapshot: payload,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Snapshot build failed",
    });
  }
}
