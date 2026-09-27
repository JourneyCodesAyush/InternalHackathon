import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.29.159",
    "192.168.29.159:3000",
    "localhost:3000",
    "127.0.0.1:3000",
  ],
  // Turbopack config (Next.js 16 default bundler)
  // The webpack alias for maplibre-gl is not needed with Turbopack;
  // maplibre-gl resolves correctly from its package.json exports.
  turbopack: {},
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'maplibre-gl': 'maplibre-gl/dist/maplibre-gl.js',
    }
    return config
  },

};

export default nextConfig;
