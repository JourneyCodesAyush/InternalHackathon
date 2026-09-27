import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import Navbar from './components/Navbar';

export const metadata: Metadata = {
  title: 'AirQ Insight | Satellite Air Quality Downscaling & Geospatial Intelligence',
  description:
    'AI/ML-powered satellite observation downscaling platform. Ingests TROPOMI Sentinel-5P NO2 rasters, fills cloud gaps, models wind advection dispersion, and attributes point-source pollution.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="h-full bg-[#0d0f15] text-[#f1f3f7] flex flex-col overflow-hidden selection:bg-[#3b82f6]/30 selection:text-white font-sans"
      >
        <AuthProvider>
          <div className="flex flex-col h-full w-full overflow-hidden">
            <Navbar />
            <div className="flex-1 min-h-0 w-full overflow-hidden relative">
              {children}
            </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
