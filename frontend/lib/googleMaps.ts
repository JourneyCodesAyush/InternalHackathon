export const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyD3hWOj4LCvdZ2dsoy2UqdGzDVcFgX9WhI';

let googleMapsPromise: Promise<any> | null = null;

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

    const script = document.createElement('script');
    script.setAttribute('data-google-maps-script', 'true');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geometry`;
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
