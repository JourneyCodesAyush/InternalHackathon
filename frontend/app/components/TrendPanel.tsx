'use client';

import React, { useState } from 'react';
import {
  X,
  Wind,
  TrendingUp,
  AlertTriangle,
  Factory,
  Car,
  Zap,
  Building,
  ShieldCheck,
  Download,
  Info,
} from 'lucide-react';
import { PinpointAttributionResult } from '@/lib/types';
import StatusBadge from './StatusBadge';
import { REGULATORY_SCALES } from '@/lib/constants';

interface TrendPanelProps {
  data: PinpointAttributionResult | null;
  onClose: () => void;
  onTimeSliderChange?: (timeOffset: number) => void;
  /** Uploaded days (from /downscale/dates) and the one shown on the map. */
  dates?: string[];
  selectedDate?: string;
  onDateChange?: (date: string) => void;
}

export default function TrendPanel({
  data,
  onClose,
  onTimeSliderChange,
  dates,
  selectedDate,
  onDateChange,
}: TrendPanelProps) {
  const [selectedHorizon, setSelectedHorizon] = useState<number>(0);

  if (!data) return null;

  const currentScale =
    REGULATORY_SCALES.find((s) => s.category === data.hazardBand) ||
    REGULATORY_SCALES[0];

  const handleHorizonClick = (offset: number) => {
    setSelectedHorizon(offset);
    onTimeSliderChange?.(offset);
  };

  const getSourceIcon = (category: string) => {
    switch (category) {
      case 'TRAFFIC_CORRIDOR':
        return <Car className="w-3.5 h-3.5 text-blue-400" />;
      case 'FACTORY':
        return <Factory className="w-3.5 h-3.5 text-amber-400" />;
      case 'POWER_PLANT':
        return <Zap className="w-3.5 h-3.5 text-rose-400" />;
      default:
        return <Building className="w-3.5 h-3.5 text-purple-400" />;
    }
  };

  // Find max forecast NO2 for relative sparkline bar heights
  const maxForecast = Math.max(...data.forecast.map((f) => f.no2Value), 150);

  // Generate synthetic CSV export
  const handleExportCSV = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        'Location,Latitude,Longitude,Current_NO2_ugm3,Hazard_Band,Wind_Speed_ms,Wind_Dir',
        `"${data.locationName}",${data.coordinates[0]},${data.coordinates[1]},${data.currentNO2},${data.hazardBand},${data.windVector.speed},"${data.windVector.direction}"`,
        '',
        'Forecast_Hour,Predicted_NO2_ugm3,Dispersion_Factor',
        ...data.forecast.map(
          (f) => `+${f.timeOffsetHours}h,${f.no2Value},${f.dispersionFactor}`
        ),
        '',
        'Source_Name,Category,Distance_km,Attribution_Percent',
        ...data.sources.map(
          (s) =>
            `"${s.name}",${s.category},${s.distanceKm || 0},${
              s.attributionPercentage || 0
            }%`
        ),
      ].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `aeropulse_trends_${data.locationName.replace(/[^a-zA-Z0-9]/g, '_')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="absolute right-4 top-4 bottom-4 w-96 max-w-[calc(100vw-2rem)] bg-[#11141d]/95 border border-[#2e3547] rounded-lg shadow-2xl backdrop-blur-md flex flex-col z-30 select-none overflow-hidden text-xs">
      {/* Header */}
      <div className="p-3.5 border-b border-[#242938] flex items-start justify-between bg-[#141721]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
              Pinpoint Intelligence
            </span>
            <span className="text-[10px] font-mono text-zinc-400">
              {data.coordinates[0].toFixed(3)}°N, {data.coordinates[1].toFixed(3)}°E
            </span>
          </div>
          <h2 className="font-semibold text-sm text-zinc-100 mt-1 truncate max-w-[270px]">
            {data.locationName}
          </h2>
          {dates && dates.length > 0 && onDateChange && (
            <label className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-400">
              Date
              <select
                value={selectedDate}
                onChange={(e) => onDateChange(e.target.value)}
                className="h-6 px-1.5 rounded bg-[#11141d] border border-[#2e3547] text-zinc-200 text-[11px] font-mono cursor-pointer [color-scheme:dark]"
                aria-label="Data date"
              >
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Close Panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* Real-time Concentration & Hazard Badge */}
        <div className="p-3 rounded-md bg-[#161a26] border border-[#242938]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-zinc-400 font-medium">
              Current Surface NO₂
            </span>
            <StatusBadge type="hazard" value={data.hazardBand} />
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-white tracking-tight">
              {data.currentNO2}
            </span>
            <span className="text-xs text-zinc-400 font-mono">µg/m³</span>
            <span className="text-[11px] text-zinc-400 ml-auto">
              {currentScale.description}
            </span>
          </div>

          {/* Health Advisory Warning */}
          <div className="mt-2.5 pt-2 border-t border-[#242938] flex items-start gap-2">
            <AlertTriangle
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: currentScale.color }}
            />
            <p className="text-[11px] text-zinc-300 leading-snug">
              {currentScale.healthAdvisory}
            </p>
          </div>
        </div>

        {/* Temporal Trends & Wind Dispersion Scrubber (Feature 2) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
              <span>Advection & Dispersion Forecast</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-400">
              <Wind className="w-3 h-3 text-teal-400" />
              <span>{data.windVector.speed} m/s {data.windVector.direction}</span>
            </div>
          </div>

          {/* CSS Sparkline Bar Chart */}
          <div className="p-3 rounded-md bg-[#161a26] border border-[#242938]">
            <div className="h-24 flex items-end justify-between gap-2 pt-2 px-1">
              {data.forecast.map((f) => {
                const heightPercent = Math.min(100, Math.round((f.no2Value / maxForecast) * 100));
                const isSelected = selectedHorizon === f.timeOffsetHours;
                const barColor =
                  f.no2Value <= 40
                    ? '#10b981'
                    : f.no2Value <= 80
                    ? '#eab308'
                    : f.no2Value <= 180
                    ? '#f97316'
                    : '#ef4444';

                return (
                  <button
                    key={f.label}
                    onClick={() => handleHorizonClick(f.timeOffsetHours)}
                    className="flex-1 flex flex-col items-center gap-1 h-full justify-end group focus:outline-none"
                  >
                    <span className="text-[10px] font-mono text-zinc-300 group-hover:text-white">
                      {f.no2Value}
                    </span>
                    <div className="w-full bg-[#202638] rounded-t overflow-hidden flex items-end h-16">
                      <div
                        className="w-full rounded-t transition-all duration-200"
                        style={{
                          height: `${heightPercent}%`,
                          backgroundColor: barColor,
                          opacity: isSelected ? 1 : 0.65,
                          outline: isSelected ? '2px solid white' : 'none',
                        }}
                      />
                    </div>
                    <span
                      className={`text-[9px] font-mono truncate ${
                        isSelected ? 'text-blue-400 font-bold' : 'text-zinc-400'
                      }`}
                    >
                      +{f.timeOffsetHours}h
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 pt-2 border-t border-[#242938] flex items-center justify-between text-[10px] text-zinc-400 font-mono">
              <span>Current Model Run</span>
              <span className="text-blue-400">
                Selected: +{selectedHorizon}h projection
              </span>
            </div>
          </div>
        </div>

        {/* Point-Source Attribution Breakdown (Feature 4 - SAWI) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
              <Factory className="w-3.5 h-3.5 text-rose-400" />
              <span>Source Attribution (SAWI Breakdown)</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-400">12KM RADIUS</span>
          </div>

          {/* Natural Language Summary as required by FR-4.4 */}
          <div className="p-2.5 rounded bg-blue-950/20 border border-blue-900/40 text-[11px] text-blue-200/90 leading-relaxed flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p>{data.summary}</p>
          </div>

          <div className="space-y-1.5">
            {data.sources.map((src) => (
              <div
                key={src.id}
                className="p-2 rounded bg-[#161a26] border border-[#242938] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-medium text-zinc-200 truncate">
                    {getSourceIcon(src.category)}
                    <span className="truncate">{src.name}</span>
                  </div>
                  <span className="font-mono font-semibold text-blue-400 text-xs shrink-0">
                    {src.attributionPercentage || 0}%
                  </span>
                </div>

                {/* Progress bar showing attribution contribution */}
                <div className="w-full h-1.5 bg-[#242938] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${src.attributionPercentage || 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                  <span>Proximity: {src.distanceKm || 0} km</span>
                  <span className="capitalize">{src.category.replace('_', ' ').toLowerCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Regulatory Compliance Verdict */}
        <div className="p-2.5 rounded bg-[#161a26] border border-[#242938] flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="font-medium text-zinc-200">Regulatory Audit Status</div>
              <div className="text-[10px] text-zinc-400">
                {data.regulatoryCompliance === 'COMPLIANT'
                  ? 'Within national standards'
                  : data.regulatoryCompliance === 'EXCEEDANCE_WARNING'
                  ? 'Exceeds 24-hr NAAQS guideline'
                  : 'Critical threshold alert triggered'}
              </div>
            </div>
          </div>
          <span
            className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
              data.regulatoryCompliance === 'COMPLIANT'
                ? 'bg-emerald-500/20 text-emerald-400'
                : data.regulatoryCompliance === 'EXCEEDANCE_WARNING'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {data.regulatoryCompliance}
          </span>
        </div>
      </div>

      {/* Footer Actions (Export CSV / GeoJSON) */}
      <div className="p-3 border-t border-[#242938] bg-[#141721] flex items-center gap-2">
        <button
          onClick={handleExportCSV}
          className="flex-1 py-1.5 px-3 rounded bg-[#1f2538] hover:bg-[#283049] border border-[#2e3547] text-zinc-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-zinc-400" />
          Export Trend CSV
        </button>
      </div>
    </div>
  );
}
