// /pages/api/salon-register.js
import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Gửi dữ liệu sang backend chính (Render server)
    const response = await axios.post(
      `${process.env.BACKEND_URL}/api/users`,  // Ví dụ: https://crypto-manager-backend.onrender.com/api/users
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    console.error("API salon-register error:", error.response?.data || error.message);
    return res.status(500).json({ error: "Đăng ký thất bại" });
  }
}
