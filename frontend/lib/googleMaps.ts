export const STORAGE_KEY_MAPS_KEY = 'aeroscale_google_maps_key';
export const STORAGE_KEY_MAPS_POOL = 'aeroscale_google_maps_pool';
export const STORAGE_KEY_AUTO_CYCLE = 'aeroscale_google_maps_autocycle';

export function getActiveGoogleMapsApiKey(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_MAPS_KEY);
      if (stored && stored.trim().length > 0) {
        return stored.trim();
      }
    } catch {
      // ignore
    }
  }
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
}

export function getKeyPool(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MAPS_POOL);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k: any) => typeof k === 'string' && k.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function setKeyPool(keys: string[]) {
  if (typeof window === 'undefined') return;
  const cleaned = keys.map(k => k.trim()).filter(k => k.length > 0);
  localStorage.setItem(STORAGE_KEY_MAPS_POOL, JSON.stringify(cleaned));
  window.dispatchEvent(new CustomEvent('aeroscale:maps_pool_updated', { detail: { pool: cleaned } }));
}

export function setActiveKey(key: string) {
  if (typeof window === 'undefined') return;
  const trimmed = key.trim();
  localStorage.setItem(STORAGE_KEY_MAPS_KEY, trimmed);
  window.dispatchEvent(new CustomEvent('aeroscale:maps_key_changed', { detail: { key: trimmed } }));
}

export function cycleToNextKey(): { nextKey: string | null; index: number; total: number } {
  if (typeof window === 'undefined') return { nextKey: null, index: -1, total: 0 };
  const pool = getKeyPool();
  if (pool.length === 0) return { nextKey: null, index: -1, total: 0 };
  
  const current = getActiveGoogleMapsApiKey();
  const currentIndex = pool.findIndex(k => k === current);
  const nextIndex = (currentIndex + 1) % pool.length;
  const nextKey = pool[nextIndex];
  
  setActiveKey(nextKey);
  return { nextKey, index: nextIndex, total: pool.length };
}

export const GOOGLE_MAPS_API_KEY = getActiveGoogleMapsApiKey();

let googleMapsPromise: Promise<any> | null = null;

export function resetGoogleMapsSdk() {
  googleMapsPromise = null;
  if (typeof document !== 'undefined') {
    const existing = document.querySelector('script[data-google-maps-script="true"]');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }
}

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not defined'));
  }

  // Already loaded
  if ((window as any).google && (window as any).google.maps) {
    return Promise.resolve((window as any).google.maps);
  }

  // In-flight loading promise
  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  const activeKey = getActiveGoogleMapsApiKey();

  googleMapsPromise = new Promise((resolve, reject) => {
    // Check if script element already exists in document
    const existingScript = document.querySelector('script[data-google-maps-script="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        resolve((window as any).google?.maps);
      });
      existingScript.addEventListener('error', (err) => {
        reject(err);
      });
      return;
    }

    // Global Google Maps Auth Failure hook
    (window as any).gm_authFailure = () => {
      console.warn('[GoogleMaps] Authentication failed for key:', activeKey ? `${activeKey.slice(0, 8)}...` : '(none)');
      window.dispatchEvent(new CustomEvent('aeroscale:maps_auth_failure', { detail: { key: activeKey } }));
      
      const autoCycle = localStorage.getItem(STORAGE_KEY_AUTO_CYCLE) === 'true';
      if (autoCycle) {
        const pool = getKeyPool();
        if (pool.length > 1) {
          const res = cycleToNextKey();
          if (res.nextKey && res.nextKey !== activeKey) {
            console.log('[GoogleMaps] Auto-cycling to next key:', `${res.nextKey.slice(0, 8)}...`);
            setTimeout(() => {
              window.location.reload();
            }, 600);
          }
        }
      }
    };

    const script = document.createElement('script');
    script.setAttribute('data-google-maps-script', 'true');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(activeKey)}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if ((window as any).google && (window as any).google.maps) {
        resolve((window as any).google.maps);
      } else {
        reject(new Error('Google Maps SDK loaded but window.google.maps is undefined'));
      }
    };

    script.onerror = (error) => {
      googleMapsPromise = null;
      window.dispatchEvent(new CustomEvent('aeroscale:maps_auth_failure', { detail: { key: activeKey } }));
      reject(new Error(`Failed to load Google Maps SDK: ${error}`));
    };

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

// Ultra-crisp cyber dark theme tailored for AeroScale's high-tech UI
export const DARK_MAP_STYLES: any[] = [
  { elementType: 'geometry', stylers: [{ color: '#10131c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#090b10' }, { weight: 3 }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ visibility: 'on' }, { color: '#273145' }],
  },
  {
    featureType: 'administrative.country',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#3b82f6' }, { weight: 1.2 }, { opacity: 0.35 }],
  },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#e2e8f0' }, { weight: 500 }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748b' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#131b26' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#38bdf8' }, { lightness: -20 }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1e2433' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#151923' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748b' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#293247' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#181e2b' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#60a5fa' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#1b2130' }],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#93c5fd' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0a0c12' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#475569' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.stroke',
    stylers: [{ color: '#090b10' }],
  },
];
