import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.29.159",
    "192.168.29.159:3000",
    "localhost:3000",
    "127.0.0.1:3000",
  ],
};

export default nextConfig;
