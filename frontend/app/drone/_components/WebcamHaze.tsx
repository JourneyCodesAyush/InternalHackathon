'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, AlertTriangle } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const UPLOAD_EVERY_MS = 10_000; // a frame for the backend DCP model (report haze readings)

interface WebcamHazeProps {
  isSimulating: boolean;
}

export default function WebcamHaze({ isSimulating }: WebcamHazeProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hazeIndex, setHazeIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!isSimulating) {
      // Clean up if simulation stops
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      setIsActive(false);
      return;
    }
    let stream: MediaStream | null = null;
    let animationFrame: number;
    let lastUpload = 0;

    // Send a frame to the backend (OpenCV Dark Channel Prior) so reports can use the haze readings
    const uploadFrame = (video: HTMLVideoElement) => {
      const snap = document.createElement('canvas');
      snap.width = 320;
      snap.height = Math.round((320 * (video.videoHeight || 240)) / (video.videoWidth || 320));
      snap.getContext('2d')?.drawImage(video, 0, 0, snap.width, snap.height);
      snap.toBlob((blob) => {
        if (!blob) return;
        const form = new FormData();
        form.append('image', blob, 'frame.jpg');
        fetch(`${API_BASE}/api/v1/drone/haze`, { method: 'POST', body: form }).catch(() => {
          /* offline: the live index on screen still works */
        });
      }, 'image/jpeg', 0.8);
    };

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsActive(true);
        }
      } catch (err) {
        setError('Camera access denied or unavailable');
        setIsActive(false);
      }
    };

    startCamera();

    const processFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Keep canvas small for fast processing
          canvas.width = 160;
          canvas.height = 120;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          
          let darkChannelSum = 0;
          let maxBrightness = 0;
          const numPixels = canvas.width * canvas.height;

          // DCP Algorithm Approximation
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            
            // Dark channel value (min of RGB)
            const minColor = Math.min(r, g, b);
            darkChannelSum += minColor;

            // Brightness (rough atmospheric light estimation)
            const brightness = (r + g + b) / 3;
            if (brightness > maxBrightness) {
              maxBrightness = brightness;
            }
          }

          const avgDark = darkChannelSum / numPixels;
          // Prevent divide by zero
          const aLight = Math.max(maxBrightness, 1);
          
          // Haze Index estimation
          const index = Math.min(avgDark / aLight, 1.0);
          
          // Simple smoothing
          setHazeIndex(prev => prev * 0.8 + index * 0.2);

          if (Date.now() - lastUpload > UPLOAD_EVERY_MS) {
            lastUpload = Date.now();
            uploadFrame(video);
          }
        }
      }
      
      // Process at ~5 fps to save CPU
      setTimeout(() => {
        animationFrame = requestAnimationFrame(processFrame);
      }, 200);
    };

    animationFrame = requestAnimationFrame(processFrame);

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      if (videoRef.current) {
         videoRef.current.srcObject = null;
      }
      cancelAnimationFrame(animationFrame);
    };
  }, [isSimulating]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-white/10 flex flex-col items-center justify-center">
      {error ? (
        <div className="text-zinc-500 flex flex-col items-center gap-2 text-sm h-full justify-center">
          <Camera className="w-8 h-8 mb-2 opacity-50" />
          <p>{error}</p>
        </div>
      ) : !isSimulating ? (
        <div className="text-zinc-500 flex flex-col items-center gap-2 text-sm h-full justify-center">
          <Camera className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-zinc-600 uppercase tracking-widest text-xs">Awaiting Connection</p>
        </div>
      ) : (
        <>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="absolute inset-0 w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          
          {/* Overlay */}
          {isActive && (
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
              <div className="bg-black/60 backdrop-blur px-3 py-1.5 rounded text-xs font-mono border border-white/10 text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                LIVE
              </div>
            </div>
          )}

          {isActive && (
            <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between">
              <div className="bg-black/80 backdrop-blur px-4 py-2 rounded-lg text-sm font-mono border border-white/20 text-white flex-1 mr-4 shadow-xl">
                <div className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">DCP Haze Index</div>
                <div className="text-2xl font-bold flex items-center gap-3">
                  {hazeIndex.toFixed(3)}
                  {hazeIndex > 0.6 && <AlertTriangle className="w-5 h-5 text-amber-500 animate-bounce" />}
                </div>
                
                {/* Visual meter */}
                <div className="w-full h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      hazeIndex > 0.6 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${hazeIndex * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
