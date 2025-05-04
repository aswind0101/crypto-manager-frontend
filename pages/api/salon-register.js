// /pages/api/salon-register.js
import axios from "axios";

export default async function handler(req, res) {
  const baseUrl = "https://crypto-manager-backend.onrender.com"
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await axios.post(
      `${baseUrl}/api/users`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization },
      }
    );

    return res.status(200).json(response.data);
  } catch (error) {
    console.error("API salon-register error:", error.response?.data || error.message);

    // Lấy lỗi chi tiết hơn
    const errorMessage =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      "Đăng ký thất bại";

    return res.status(500).json({ error: errorMessage });
  }
}
