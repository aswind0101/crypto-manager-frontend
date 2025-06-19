// 📁 backend/routes/appointments.js
import express from "express";
import verifyToken from "../middleware/verifyToken.js";
import { sendBookingEmail } from "../utils/sendBookingEmail.js";
import { sendAppointmentStatusEmail } from "../utils/sendAppointmentStatusEmail.js";
import { sendStylistCommissionChargedEmail } from '../utils/sendStylistCommissionChargedEmail.js';

import Stripe from "stripe";
import dayjs from "dayjs";
import pkg from "pg";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { Pool } = pkg;
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
// ✅ GET: Trả về danh sách lịch hẹn của stylist trong 1 ngày
router.get("/availability", async (req, res) => {
  const { stylist_id, date } = req.query;

  if (!stylist_id || !date) {
    return res.status(400).json({ error: "Missing stylist_id or date." });
  }

  try {
    // Tính khoảng thời gian từ 00:00 đến 23:59 ngày đó
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    const result = await pool.query(
      `SELECT 
         appointment_date, 
         COALESCE(duration_minutes, 30) AS duration_minutes
       FROM appointments
       WHERE stylist_id = $1
         AND appointment_date BETWEEN $2 AND $3
         AND status IN ('pending', 'confirmed')`,
      [stylist_id, dayStart, dayEnd]
    );

    res.json(result.rows); // Trả về danh sách các khung giờ đã được đặt
  } catch (err) {
    console.error("❌ Error fetching availability:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// ✅ POST: Khách tạo hẹn mới
router.post("/", verifyToken, async (req, res) => {
  const { uid } = req.user;
  const {
    stylist_id,
    salon_id,
    service_ids,
    appointment_date,
    duration_minutes,
    note,
    phone,
  } = req.body;

  if (!stylist_id || !salon_id || !service_ids || !appointment_date || !phone) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // ✅ Kiểm tra stylist đã có lịch bị trùng không
  const newStart = new Date(appointment_date);
  const newEnd = new Date(newStart.getTime() + duration_minutes * 60000);

  const conflictCheck = await pool.query(
    `SELECT 1 FROM appointments 
     WHERE stylist_id = $1 
       AND status IN ('pending', 'confirmed') 
       AND (
         appointment_date < $3
         AND appointment_date + INTERVAL '1 minute' * COALESCE(duration_minutes, 30) > $2
       )`,
    [stylist_id, newStart, newEnd]
  );

  if (conflictCheck.rows.length > 0) {
    return res.status(409).json({
      error: "❌ Stylist already has an appointment in this time range.",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO appointments (
         customer_uid, stylist_id, salon_id, service_ids,
         appointment_date, duration_minutes, note, phone
       ) VALUES (
         $1, $2, $3, $4,
         TO_TIMESTAMP($5, 'YYYY-MM-DD HH24:MI:SS'),
         $6, $7, $8
       ) RETURNING *`,
      [uid, stylist_id, salon_id, service_ids, appointment_date, duration_minutes, note || null, phone]
    );

    const appointment = result.rows[0];

    // ✅ Gửi email xác nhận
    try {
      // Lấy email khách hàng
      const userRes = await pool.query(
        `SELECT email FROM users WHERE firebase_uid = $1`,
        [uid]
      );
      const to = userRes.rows[0]?.email;

      // Lấy tên stylist + salon
      const stylistRes = await pool.query(
        `SELECT name FROM freelancers WHERE id = $1`,
        [stylist_id]
      );
      const stylistName = stylistRes.rows[0]?.name || "Stylist";

      const salonRes = await pool.query(
        `SELECT name FROM salons WHERE id = $1`,
        [salon_id]
      );
      const salonName = salonRes.rows[0]?.name || "Salon";

      // Lấy thông tin dịch vụ
      const serviceRes = await pool.query(
        `SELECT name, price, duration_minutes FROM salon_services WHERE id = ANY($1)`,
        [service_ids]
      );

      const formattedDate = dayjs(appointment_date).format("MMMM D, YYYY – hh:mm A");

      if (to) {
        await sendBookingEmail({
          to,
          customerName: to.split("@")[0],
          stylistName,
          salonName,
          dateTime: formattedDate,
          services: serviceRes.rows,
        });
        console.log("✅ Booking email sent to", to);
      }
    } catch (emailErr) {
      console.error("❌ Failed to send booking email:", emailErr.message);
    }

    res.status(201).json(appointment);
  } catch (err) {
    console.error("❌ Error creating appointment:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// ✅ GET: Khách lấy danh sách hẹn của mình
router.get("/me", verifyToken, async (req, res) => {
  const { uid } = req.user;
  try {
    const result = await pool.query(`
      SELECT 
        a.id,
        a.appointment_date,
        a.duration_minutes,
        a.note,
        a.status,
        a.started_at,  
        a.end_at,
        f.name AS stylist_name,
        f.avatar_url AS stylist_avatar,
        f.specialization AS stylist_specialization,
        f.phone AS stylist_phone,
        s.name AS salon_name,
        s.address AS salon_address,
        ARRAY(
          SELECT json_build_object('id', ss.id, 'name', ss.name, 'price', ss.price, 'duration', ss.duration_minutes)
          FROM salon_services ss
          WHERE ss.id = ANY(a.service_ids)
        ) AS services,
        ARRAY(
          SELECT json_build_object(
            'id', m.id,
            'message', m.message,
            'sender_role', m.sender_role,
            'created_at', m.created_at,
            'is_read', m.is_read
          )
          FROM appointment_messages m
          WHERE m.appointment_id = a.id
          ORDER BY m.created_at ASC
        ) AS messages
      FROM appointments a
      JOIN freelancers f ON a.stylist_id = f.id
      JOIN salons s ON a.salon_id = s.id
      WHERE a.customer_uid = $1
      ORDER BY a.appointment_date DESC
    `, [uid]);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching appointments:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// ✅ GET: Stylist lấy lịch hẹn của mình
router.get("/freelancer", verifyToken, async (req, res) => {
  const { uid } = req.user;
  try {
    const stylist = await pool.query(
      `SELECT id FROM freelancers WHERE firebase_uid = $1`,
      [uid]
    );
    if (stylist.rows.length === 0) return res.status(403).json({ error: "Stylist not found" });

    const stylistId = stylist.rows[0].id;
    const result = await pool.query(`
  SELECT 
    a.id,
    a.appointment_date,
    a.duration_minutes,
    a.status,
    a.started_at,
    a.end_at,     
    a.note,
    a.customer_uid,
    a.stylist_id,
    a.phone AS customer_phone,
    c.name AS customer_name,
    s.name AS salon_name,
    s.id AS salon_id,
    ARRAY(
      SELECT json_build_object(
        'id', ss.id,
        'name', ss.name,
        'price', ss.price,
        'duration', ss.duration_minutes
      )
      FROM salon_services ss
      WHERE ss.id = ANY(a.service_ids)
    ) AS services
  FROM appointments a
  JOIN freelancers f ON a.stylist_id = f.id
  LEFT JOIN customers c ON a.customer_uid = c.firebase_uid
  LEFT JOIN salons s ON a.salon_id = s.id
  WHERE f.firebase_uid = $1
  ORDER BY a.appointment_date ASC
`, [uid]);


    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching stylist appointments:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// LẤY TẤT CẢ LỊCH HẸN của 1 salon trong 1 ngày
router.get("/salon", verifyToken, async (req, res) => {
  const { uid } = req.user;
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Missing date" });

  try {
    // Lấy salon_id mà chủ salon đang quản lý
    const salonRes = await pool.query(
      `SELECT id FROM salons WHERE owner_user_id = $1`, [uid]
    );
    if (!salonRes.rows.length) return res.status(404).json({ error: "Salon not found" });
    const salon_id = salonRes.rows[0].id;

    // Lấy appointments của salon ngày đó, join với FREELANCERS
    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    const result = await pool.query(`
      SELECT 
        a.*,
        f.id as stylist_id,
        f.name as stylist_name,
        f.avatar_url as stylist_avatar,
        c.name as customer_name,
        a.phone AS customer_phone,
        ARRAY(
          SELECT json_build_object(
            'id', ss.id,
            'name', ss.name,
            'price', ss.price,
            'duration', ss.duration_minutes
          )
          FROM salon_services ss
          WHERE ss.id = ANY(a.service_ids)
        ) AS services
      FROM appointments a
      JOIN freelancers f ON a.stylist_id = f.id
      LEFT JOIN customers c ON a.customer_uid = c.firebase_uid
      WHERE a.salon_id = $1
        AND a.appointment_date BETWEEN $2 AND $3
      ORDER BY a.appointment_date ASC
    `, [salon_id, start, end]);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching salon appointments:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// BIỂU ĐỒ DOANH THU: trả về [{date, revenue}]
router.get("/salon/revenue", verifyToken, async (req, res) => {
  const { uid } = req.user;
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: "Missing from/to" });

  try {
    // Lấy salon_id mà chủ salon đang quản lý
    const salonRes = await pool.query(
      `SELECT id FROM salons WHERE owner_user_id = $1`, [uid]
    );
    if (!salonRes.rows.length) return res.status(404).json({ error: "Salon not found" });
    const salon_id = salonRes.rows[0].id;

    // Lấy doanh thu từng ngày (tính trên status 'completed')
    const result = await pool.query(`
      SELECT 
        DATE(appointment_date) as date,
        SUM(
          (
            SELECT COALESCE(SUM(ss.price),0)
            FROM salon_services ss
            WHERE ss.id = ANY(a.service_ids)
          )
        ) as revenue
      FROM appointments a
      WHERE a.salon_id = $1 
        AND a.status = 'completed'
        AND a.appointment_date BETWEEN $2 AND $3
      GROUP BY DATE(appointment_date)
      ORDER BY date ASC
    `, [salon_id, from, to]);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching salon revenue:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// ✅ PATCH: Cập nhật trạng thái lịch hẹn
router.patch("/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status, started_at, end_at } = req.body;

  // Bổ sung "processing" vào danh sách hợp lệ
  if (!["pending", "confirmed", "processing", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    // Nếu status là "confirmed", thực hiện charge 5% hoa hồng ngay
    if (status === "confirmed") {
      // Lấy thông tin appointment
      const apptRes = await pool.query(
        `SELECT * FROM appointments WHERE id = $1`,
        [id]
      );
      if (apptRes.rows.length === 0) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      const appt = apptRes.rows[0];

      // Lấy thông tin freelancer để charge 5%
      const freelancerRes = await pool.query(
        `SELECT stripe_customer_id, stripe_payment_method_id, name, email FROM freelancers WHERE id = $1`,
        [appt.stylist_id]
      );
      const freelancer = freelancerRes.rows[0];
      if (!freelancer || !freelancer.stripe_customer_id || !freelancer.stripe_payment_method_id) {
        return res.status(400).json({ error: "Freelancer chưa thêm payment method hoặc chưa liên kết Stripe!" });
      }

      // Tính tổng tiền dịch vụ của appointment
      const serviceRes = await pool.query(
        `SELECT price FROM salon_services WHERE id = ANY($1)`,
        [appt.service_ids]
      );
      const totalAmount = serviceRes.rows.reduce((sum, s) => sum + (s.price || 0), 0);
      const feeAmount = Math.round(totalAmount * 0.05 * 100); // 5% (USD → cent)

      if (feeAmount > 0) {
        try {
          await stripe.paymentIntents.create({
            amount: feeAmount,
            currency: "usd",
            customer: freelancer.stripe_customer_id,
            payment_method: freelancer.stripe_payment_method_id,
            off_session: true,
            confirm: true,
            description: `5% commission for confirming appointment #${appt.id}`,
            receipt_email: freelancer.email,
          });

          // Sau khi charge thành công, gửi email cho stylist
          // Lấy các dữ liệu cần thiết cho email
          const stylistEmail = freelancer.email;
          const stylistName = freelancer.name;
          const salonRes = await pool.query(
            `SELECT name FROM salons WHERE id = $1`,
            [appt.salon_id]
          );
          const salonName = salonRes.rows[0]?.name || "Salon";
          const servicesRes = await pool.query(
            `SELECT name, price, duration_minutes FROM salon_services WHERE id = ANY($1)`,
            [appt.service_ids]
          );
          const services = servicesRes.rows;
          const totalAmount = services.reduce((sum, s) => sum + parseFloat(s.price), 0);
          const commission = totalAmount * 0.05;
          const formattedDate = dayjs(appt.appointment_date).format("MMMM D, YYYY – hh:mm A");

          if (stylistEmail) {
            await sendStylistCommissionChargedEmail({
              to: stylistEmail,
              stylistName,
              appointmentId: appt.id,
              dateTime: formattedDate,
              salonName,
              services,
              totalAmount,
              commission,
            });
          }

        } catch (err) {
          // Nếu charge lỗi, báo về FE và giữ nguyên trạng thái pending
          return res.status(402).json({
            error: "Could not charge commission fee. Please check your payment method or balance.",
            stripeError: err.message,
          });
        }
      }

    }
    // Tạo câu lệnh SQL động: nếu có started_at thì update cả 2 trường, nếu không chỉ update status
    let updateFields = ['status'];
    let values = [status];
    let idx = 2;

    if (started_at) {
      updateFields.push('started_at');
      values.push(started_at);
      idx++;
    }
    if (end_at) {
      updateFields.push('end_at');
      values.push(end_at);
      idx++;
    }

    let setClause = updateFields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    values.push(id);

    const result = await pool.query(
      `UPDATE appointments SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const appt = result.rows[0];

    // ✅ Gửi email nếu là confirmed, cancelled, hoặc processing
    if (["confirmed", "cancelled", "processing"].includes(status)) {
      try {
        const customerRes = await pool.query(
          `SELECT email FROM users WHERE firebase_uid = $1`,
          [appt.customer_uid]
        );
        const to = customerRes.rows[0]?.email;

        const stylistRes = await pool.query(
          `SELECT name FROM freelancers WHERE id = $1`,
          [appt.stylist_id]
        );
        const salonRes = await pool.query(
          `SELECT name FROM salons WHERE id = $1`,
          [appt.salon_id]
        );
        const servicesRes = await pool.query(
          `SELECT name, price, duration_minutes FROM salon_services WHERE id = ANY($1)`,
          [appt.service_ids]
        );

        const formattedDate = dayjs(appt.appointment_date).format("MMMM D, YYYY – hh:mm A");

        if (to) {
          await sendAppointmentStatusEmail({
            to,
            customerName: to.split("@")[0],
            stylistName: stylistRes.rows[0]?.name || "Stylist",
            salonName: salonRes.rows[0]?.name || "Salon",
            dateTime: formattedDate,
            status,
            services: servicesRes.rows,
          });
          console.log(`📧 Email sent to ${to} for status: ${status}`);
        }
      } catch (emailErr) {
        console.error("❌ Failed to send status email:", emailErr.message);
      }
    }

    res.json(appt);
  } catch (err) {
    console.error("❌ Error updating appointment status:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ DELETE: Khách huỷ lịch nếu chưa tới giờ
router.delete("/:id", verifyToken, async (req, res) => {
  const { uid } = req.user;
  const { id } = req.params;

  try {
    const check = await pool.query(`
      SELECT appointment_date, status
      FROM appointments
      WHERE id = $1 AND customer_uid = $2
    `, [id, uid]);

    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const { status } = check.rows[0];

    if (status !== "pending") {
      return res.status(400).json({ error: "Only pending appointments can be cancelled." });
    }

    // ✅ KHÔNG kiểm tra thời gian nữa — frontend lo phần này rồi
    await pool.query("DELETE FROM appointments WHERE id = $1", [id]);

    res.json({ message: "✅ Appointment cancelled." });
  } catch (err) {
    console.error("❌ Error cancelling appointment:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
router.post("/messages", verifyToken, async (req, res) => {
  const { appointment_id, message, created_at } = req.body;
  const { uid } = req.user;

  if (!appointment_id || !message) {
    return res.status(400).json({ error: "Missing appointment_id or message" });
  }

  try {
    // Ưu tiên freelancer
    const freelancerRes = await pool.query(
      `SELECT name, phone FROM freelancers WHERE firebase_uid = $1`,
      [uid]
    );

    if (freelancerRes.rows.length > 0) {
      const { name, phone } = freelancerRes.rows[0];
      await pool.query(
        `INSERT INTO appointment_messages (
          appointment_id, sender_role, sender_name, sender_phone, message, created_at
        ) VALUES ($1, 'freelancer', $2, $3, $4, TO_TIMESTAMP($5, 'YYYY-MM-DD HH24:MI:SS'))`,
        [appointment_id, name, phone, message, created_at]
      );
      return res.json({ success: true });
    }

    // Nếu không phải freelancer → thử kiểm tra customer
    const customerRes = await pool.query(
      `SELECT name, phone FROM customers WHERE firebase_uid = $1`,
      [uid]
    );

    if (customerRes.rows.length > 0) {
      const { name, phone } = customerRes.rows[0];
      await pool.query(
        `INSERT INTO appointment_messages (
          appointment_id, sender_role, sender_name, sender_phone, message, created_at
        ) VALUES ($1, 'customer', $2, $3, $4, TO_TIMESTAMP($5, 'YYYY-MM-DD HH24:MI:SS'))`,
        [appointment_id, name, phone, message, created_at]
      );
      return res.json({ success: true });
    }

    return res.status(403).json({ error: "Unauthorized user" });
  } catch (err) {
    console.error("❌ Error sending message:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


router.get("/messages", verifyToken, async (req, res) => {
  const { uid } = req.user;

  try {
    // 1. Lấy freelancer ID
    const stylistRes = await pool.query(
      `SELECT id FROM freelancers WHERE firebase_uid = $1`,
      [uid]
    );
    if (stylistRes.rows.length === 0) return res.json([]);

    const stylistId = stylistRes.rows[0].id;

    // 2. Lấy các cuộc hẹn 'confirmed'
    const appointmentsRes = await pool.query(
      `SELECT id, customer_uid, appointment_date 
       FROM appointments 
       WHERE stylist_id = $1 AND status = 'confirmed'`,
      [stylistId]
    );

    const appointments = appointmentsRes.rows;
    if (appointments.length === 0) return res.json([]);

    const appointmentIds = appointments.map(a => a.id);

    // 3. Lấy tất cả message của customer trong các appointment đó
    const messagesRes = await pool.query(
      `SELECT * FROM appointment_messages 
       WHERE appointment_id = ANY($1) 
       AND sender_role = 'customer'
       ORDER BY created_at DESC`,
      [appointmentIds]
    );

    // 4. Gắn thêm thông tin lịch hẹn
    const enriched = messagesRes.rows.map(m => {
      const appt = appointments.find(a => a.id === m.appointment_id);
      return {
        ...m,
        appointment_date: appt?.appointment_date,
        customer_uid: appt?.customer_uid,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("❌ Error fetching messages:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/messages/:id/read", verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE appointment_messages SET is_read = TRUE WHERE id = $1`,
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error marking message as read:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id/messages", verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM appointment_messages 
       WHERE appointment_id = $1 
       AND sender_role = 'customer'
       ORDER BY created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching messages:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/messages/unread-count", verifyToken, async (req, res) => {
  const { uid } = req.user;
  try {
    const freelancerRes = await pool.query(
      `SELECT id FROM freelancers WHERE firebase_uid = $1`, [uid]
    );
    const freelancerId = freelancerRes.rows[0]?.id;
    if (!freelancerId) return res.json({ count: 0 });

    const appointmentIdsRes = await pool.query(
      `SELECT id FROM appointments WHERE stylist_id = $1 AND status = 'confirmed'`,
      [freelancerId]
    );
    const ids = appointmentIdsRes.rows.map(r => r.id);
    if (ids.length === 0) return res.json({ count: 0 });

    const unreadRes = await pool.query(
      `SELECT COUNT(*) FROM appointment_messages
       WHERE appointment_id = ANY($1)
       AND sender_role = 'customer'
       AND is_read = FALSE`,
      [ids]
    );

    res.json({ count: parseInt(unreadRes.rows[0].count, 10) });
  } catch (err) {
    console.error("❌ Error counting unread messages:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Đánh dấu tất cả tin nhắn stylist (chưa đọc) của 1 appointment là đã đọc
router.patch("/:id/read-all", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { sender_role } = req.body;

  if (!["freelancer", "customer"].includes(sender_role)) {
    return res.status(400).json({ error: "Invalid sender_role" });
  }

  try {
    const result = await pool.query(
      `UPDATE appointment_messages
       SET is_read = TRUE
       WHERE appointment_id = $1 AND sender_role = $2 AND is_read = FALSE
       RETURNING id`,
      [id, sender_role]
    );

    console.log("🔄 Messages marked as read:", result.rows);
    res.json({ success: true, updated: result.rows.length });
  } catch (err) {
    console.error("❌ Error marking messages as read:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// 📌 API mới: Lấy toàn bộ tin nhắn (cả customer và stylist) theo appointment_id
router.get("/:id/messages/all", verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM appointment_messages 
       WHERE appointment_id = $1 
       ORDER BY created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching all messages:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
