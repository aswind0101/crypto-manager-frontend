/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Allow dev access via LAN IP (Next.js 15+)
  allowedDevOrigins: [
  "http://localhost:3000",
  "http://192.168.1.247:3000",
  "http://0.0.0.0:3000",
],
};

export default nextConfig;
