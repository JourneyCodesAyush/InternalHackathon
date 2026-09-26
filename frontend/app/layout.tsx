import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AeroScale | Satellite Air Quality Downscaling & Geospatial Intelligence",
  description:
    "AI/ML-powered satellite observation downscaling platform. Ingests TROPOMI Sentinel-5P NO2 rasters, fills cloud gaps, models wind advection dispersion, and attributes point-source pollution.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-[#0d0f15] text-[#f1f3f7] flex flex-col overflow-hidden selection:bg-[#3b82f6]/30 selection:text-white font-sans">
        {children}
      </body>
    </html>
  );
}
