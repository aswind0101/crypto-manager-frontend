/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Chấp nhận tồn tại lỗi ESLint khi build production
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
