export async function checkFreelancerExists(user) {
  if (!user || !user.getIdToken) return false;
  try {
    const token = await user.getIdToken();
    const res = await fetch("https://crypto-manager-backend.onrender.com/api/freelancers/check", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    console.log("checkFreelancerExists API response:", data); // THÊM DÒNG NÀY
    return data.exists === true;
  } catch (err) {
    console.error("❌ checkFreelancerExists error:", err);
    return false;
  }
}
