// 📁 routes/services.js
import express from "express";
import verifyToken from "../middleware/verifyToken.js";
import pkg from "pg";
const { Pool } = pkg;

const router = express.Router();

// ✅ Kết nối database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
// ✅ GET: Lấy danh sách dịch vụ của salon hiện tại (nếu ?me=1)
router.get("/", verifyToken, async (req, res) => {
  const { uid } = req.user;

  // Lấy theo salon hiện tại
  if (req.query.me === "1") {
    try {
      const salonRes = await pool.query(
        `SELECT id FROM salons WHERE owner_user_id = $1`,
        [uid]
      );

      if (salonRes.rows.length === 0) {
        return res.status(404).json({ error: "Salon not found for current user." });
      }

      const salon_id = salonRes.rows[0].id;

      const result = await pool.query(
        `SELECT * FROM salon_services WHERE salon_id = $1 AND is_active = true ORDER BY created_at DESC`,
        [salon_id]
      );

      res.json(result.rows);
    } catch (err) {
      console.error("❌ Error fetching services:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
    }
  } else {
    res.status(400).json({ error: "Missing or invalid query: me=1" });
  }
});
// ✅ POST: Tạo dịch vụ mới cho salon
router.post("/", verifyToken, async (req, res) => {
  const { uid } = req.user;
  const {
    specialization,
    name,
    description,
    price,
    duration_minutes,
    promotion
  } = req.body;

  // Kiểm tra thông tin bắt buộc
  if (!specialization || !name || !price || !duration_minutes) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    // 🔍 Tìm salon_id từ uid chủ salon
    const salonRes = await pool.query(
      `SELECT id FROM salons WHERE owner_user_id = $1`,
      [uid]
    );

    if (salonRes.rows.length === 0) {
      return res.status(404).json({ error: "Salon not found for this user." });
    }

    const salon_id = salonRes.rows[0].id;

    // ➕ Thêm dịch vụ
    const insert = await pool.query(
      `INSERT INTO salon_services
      (salon_id, specialization, name, description, price, duration_minutes, promotion)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [salon_id, specialization, name, description, price, duration_minutes, promotion]
    );

    res.status(201).json(insert.rows[0]);
  } catch (err) {
    console.error("❌ Error creating service:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
