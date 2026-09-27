'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, MapPin, X, Loader2, Navigation } from 'lucide-react';

interface LocationSearchProps {
  onSelectLocation: (name: string, coords: [number, number]) => void;
  selectedLocationName?: string;
}

interface SearchSuggestion {
  displayName: string;
  coords: [number, number];
  subtext: string;
}

// Pre-cached local benchmark points for instant zero-latency response
const INSTANT_LOCATIONS: SearchSuggestion[] = [
  {
    displayName: 'Shivaji Park, Mumbai',
    coords: [19.0269, 72.8378],
    subtext: 'Coastal residential / recreation zone near Western corridor',
  },
  {
    displayName: 'Bandra-Kurla Complex (BKC), Mumbai',
    coords: [19.0657, 72.8683],
    subtext: 'Heavy transit and commercial financial centre',
  },
  {
    displayName: 'Trombay Industrial & Power Cluster, Mumbai',
    coords: [19.002, 72.905],
    subtext: 'Refinery, thermal power stacks & petrochem plants',
  },
  {
    displayName: 'Anand Vihar, New Delhi',
    coords: [28.6469, 77.2882],
    subtext: 'Interstate transport hub & industrial perimeter',
  },
  {
    displayName: 'Connaught Place, Central Delhi',
    coords: [28.6304, 77.2177],
    subtext: 'Urban core with heavy radial vehicular flow',
  },
  {
    displayName: 'Peenya Industrial Area, Bengaluru',
    coords: [13.0285, 77.5197],
    subtext: 'Major manufacturing cluster in South Asia',
  },
];

export default function LocationSearch({
  onSelectLocation,
  selectedLocationName,
}: LocationSearchProps) {
  const [query, setQuery] = useState(selectedLocationName || '');
  const [prevSelected, setPrevSelected] = useState(selectedLocationName);
  const [isOpen, setIsOpen] = useState(false);
  const [apiSuggestions, setApiSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync state with incoming prop change without calling setState in an effect
  if (selectedLocationName !== prevSelected) {
    setPrevSelected(selectedLocationName);
    setQuery(selectedLocationName || '');
  }

  // Handle outside clicks to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter local spots synchronously without effect
  const localMatches = useMemo(() => {
    if (!query.trim()) return INSTANT_LOCATIONS;
    return INSTANT_LOCATIONS.filter((item) =>
      item.displayName.toLowerCase().includes(query.toLowerCase())
    );
  }, [query]);

  // Query Nominatim geocoder asynchronously on typing
  useEffect(() => {
    if (query.trim().length <= 2) {
      return;
    }

    let isSubscribed = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const google = (window as any).google;
        let foundGoogleResults = false;

        if (google?.maps?.Geocoder) {
          try {
            const geocoder = new google.maps.Geocoder();
            const response = await new Promise<any[]>((resolve) => {
              geocoder.geocode({ address: query }, (results: any[], status: string) => {
                if (status === 'OK' && results) {
                  resolve(results);
                } else {
                  resolve([]);
                }
              });
            });

            if (response && response.length > 0 && isSubscribed) {
              foundGoogleResults = true;
              const suggestions: SearchSuggestion[] = response.slice(0, 5).map((r) => ({
                displayName: r.formatted_address.split(',').slice(0, 3).join(','),
                coords: [r.geometry.location.lat(), r.geometry.location.lng()],
                subtext: r.formatted_address,
              }));
              setApiSuggestions(suggestions);
            }
          } catch {
            // Fall through to fallback
          }
        }

        if (!foundGoogleResults) {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
              query
            )}&limit=4`,
            {
              headers: {
                'Accept-Language': 'en',
              },
            }
          );
          if (res.ok && isSubscribed) {
            const data = await res.json();
            const externalSuggestions: SearchSuggestion[] = data.map(
              (item: { display_name: string; lat: string; lon: string }) => ({
                displayName: item.display_name.split(',').slice(0, 3).join(','),
                coords: [parseFloat(item.lat), parseFloat(item.lon)],
                subtext: item.display_name,
              })
            );
            setApiSuggestions(externalSuggestions);
          }
        }
      } catch {
        // Fallback silently if offline or throttled
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Combine local and API suggestions
  const combinedSuggestions = useMemo(() => {
    if (!query.trim()) return INSTANT_LOCATIONS;
    const merged = [...localMatches];
    apiSuggestions.forEach((ext) => {
      if (!merged.some((m) => m.displayName.toLowerCase() === ext.displayName.toLowerCase())) {
        merged.push(ext);
      }
    });
    return merged.slice(0, 6);
  }, [query, localMatches, apiSuggestions]);

  const handleSelect = (item: SearchSuggestion) => {
    setQuery(item.displayName);
    setIsOpen(false);
    onSelectLocation(item.displayName, item.coords);
  };

  const handleClear = () => {
    setQuery('');
    setApiSuggestions([]);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md select-none">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#141721]/95 border border-[#2e3547] rounded-md shadow-xl backdrop-blur-md focus-within:border-blue-500 transition-colors">
        <Search className="w-4 h-4 text-zinc-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search location or pinpoint coordinates (e.g. Shivaji Park)..."
          className="flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
        />

        {loading && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />}

        {query && !loading && (
          <button
            onClick={handleClear}
            className="p-0.5 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          onClick={() => {
            if (combinedSuggestions.length > 0) {
              handleSelect(combinedSuggestions[0]);
            }
          }}
          title="Search / Analyze Point"
          className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium rounded flex items-center gap-1 transition-colors"
        >
          <Navigation className="w-3 h-3" />
          <span>Analyze</span>
        </button>
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && combinedSuggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#141721] border border-[#2e3547] rounded-md shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-1.5 bg-[#0f121a] border-b border-[#242938] text-[10px] uppercase font-semibold text-zinc-400 tracking-wider flex items-center justify-between">
            <span>Location Predictions</span>
            <span className="font-mono text-zinc-400">SELECT TO ATTRIBUTE</span>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {combinedSuggestions.map((item, idx) => (
              <button
                key={`${item.displayName}-${idx}`}
                onClick={() => handleSelect(item)}
                className="w-full text-left px-3 py-2 hover:bg-[#1c2233] border-b border-[#1f2433] last:border-none flex items-start gap-2.5 transition-colors"
              >
                <MapPin className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-200 truncate">
                    {item.displayName}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {item.subtext}
                  </div>
                </div>
                <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                  {item.coords[0].toFixed(2)}, {item.coords[1].toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
