// 📁 components/utils/checkFreelancer.js
export async function checkFreelancerExists(user) {
  if (!user || typeof user.getIdToken !== "function") {
    console.warn("⚠️ Invalid Firebase user object.");
    return false;
  }

  try {
    const token = await user.getIdToken();

    if (!token) {
      console.warn("⚠️ Token is empty or undefined.");
      return false;
    }

    const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/check", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const errorText = await res.text(); // đọc chi tiết nếu backend trả lỗi
      console.error(`❌ API responded with status ${res.status}: ${errorText}`);
      return false;
    }

    const data = await res.json();
    console.log("✅ checkFreelancerExists response:", data);

    return data.exists === true;
  } catch (err) {
    console.error("❌ checkFreelancerExists error:", err.name, err.message);
    return false;
  }
}
