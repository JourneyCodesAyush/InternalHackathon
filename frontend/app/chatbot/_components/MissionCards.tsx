'use client';

import React, { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  Plane,
  FileText,
  ChevronDown,
  ChevronRight,
  Zap,
  Users,
  MapPin,
  Wind,
  Eye,
  Battery,
  CheckCircle2,
  XCircle,
  Radio,
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────────────────────── */
interface MissionCard {
  type: string;
  title: string;
  icon?: string;
  [key: string]: any;
}

interface MissionCardsProps {
  cards: Array<Record<string, any>>;
  riskLevel?: string | null;
  activeSpecialists?: string[];
  autonomousTriggers?: string[];
}

/* ── Colour maps ────────────────────────────────────────────────────────────── */
const RISK_CONFIG: Record<string, { bg: string; border: string; text: string; glow: string; label: string }> = {
  critical: {
    bg: 'from-rose-950/60 to-rose-900/30',
    border: 'border-rose-500/40',
    text: 'text-rose-400',
    glow: 'shadow-rose-500/10',
    label: '🔴 CRITICAL',
  },
  high: {
    bg: 'from-orange-950/60 to-orange-900/30',
    border: 'border-orange-500/40',
    text: 'text-orange-400',
    glow: 'shadow-orange-500/10',
    label: '🟠 HIGH',
  },
  moderate: {
    bg: 'from-yellow-950/60 to-yellow-900/30',
    border: 'border-yellow-500/40',
    text: 'text-yellow-400',
    glow: 'shadow-yellow-500/10',
    label: '🟡 MODERATE',
  },
  low: {
    bg: 'from-emerald-950/60 to-emerald-900/30',
    border: 'border-emerald-500/40',
    text: 'text-emerald-400',
    glow: 'shadow-emerald-500/10',
    label: '🟢 LOW',
  },
};

const CLASSIFICATION_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  hazardous: { bg: 'bg-rose-500/15', text: 'text-rose-400', label: 'HAZARDOUS' },
  investigation: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'INVESTIGATION' },
  advisory: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'ADVISORY' },
};

const ICON_MAP: Record<string, React.ReactNode> = {
  shield: <Shield className="w-4 h-4" />,
  'shield-check': <ShieldCheck className="w-4 h-4" />,
  'alert-triangle': <AlertTriangle className="w-4 h-4" />,
  'trending-up': <TrendingUp className="w-4 h-4" />,
  plane: <Plane className="w-4 h-4" />,
  'file-text': <FileText className="w-4 h-4" />,
};

/* ── Individual card renderers ──────────────────────────────────────────────── */

function StatusCard({ card }: { card: MissionCard }) {
  const risk = RISK_CONFIG[card.risk_level] || RISK_CONFIG.low;
  return (
    <div className={`rounded-xl border ${risk.border} bg-gradient-to-br ${risk.bg} p-4 shadow-lg ${risk.glow}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg bg-black/20 ${risk.text}`}>
            <Shield className="w-5 h-5" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Mission Status</span>
        </div>
        <span className={`text-sm font-bold ${risk.text}`}>{risk.label}</span>
      </div>
      <p className="text-sm font-medium text-zinc-200 leading-relaxed">{card.headline}</p>
      {card.location && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
          <MapPin className="w-3 h-3" />
          <span>{card.location}</span>
        </div>
      )}
    </div>
  );
}

function AnalysisAgentCard({ card }: { card: MissionCard }) {
  const [expanded, setExpanded] = useState(false);
  const sevMap: Record<string, { bg: string; text: string }> = {
    hazardous: { bg: 'bg-rose-500/15', text: 'text-rose-400' },
    critical: { bg: 'bg-rose-500/15', text: 'text-rose-400' },
    elevated: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
    normal: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  };
  const sevConfig = sevMap[card.severity || 'normal'] || { bg: 'bg-zinc-500/15', text: 'text-zinc-400' };

  return (
    <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-950/30 to-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Anomaly Intelligence</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${sevConfig.bg} ${sevConfig.text}`}>
          {card.severity || 'normal'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3">
        <div className="text-center">
          <div className="text-lg font-bold text-zinc-100">{card.anomaly_count || 0}</div>
          <div className="text-[10px] text-zinc-500 uppercase">Anomalies</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-zinc-100">{card.hotspot_count || 0}</div>
          <div className="text-[10px] text-zinc-500 uppercase">Hotspots</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-zinc-100">
            {card.affected_area_km2 ? `${card.affected_area_km2}` : '—'}
          </div>
          <div className="text-[10px] text-zinc-500 uppercase">km² affected</div>
        </div>
      </div>

      {card.population_exposed != null && (
        <div className="flex items-center gap-1.5 mt-3 px-2 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/15">
          <Users className="w-3 h-3 text-rose-400" />
          <span className="text-xs text-rose-300">{card.population_exposed.toLocaleString()} people exposed above CPCB limit</span>
        </div>
      )}

      {card.sources && card.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {card.sources.map((s: string) => (
            <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400">
              {s.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}

      {card.summary && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}
      {expanded && card.summary && (
        <div className="mt-2 text-xs text-zinc-400 leading-relaxed border-t border-zinc-800 pt-2 whitespace-pre-wrap">
          {card.summary}
        </div>
      )}
    </div>
  );
}

function ForecastCard({ card }: { card: MissionCard }) {
  const trendConfig: Record<string, { icon: React.ReactNode; text: string; label: string }> = {
    rising: { icon: <TrendingUp className="w-3 h-3" />, text: 'text-rose-400', label: '↑ RISING' },
    falling: { icon: <TrendingUp className="w-3 h-3 rotate-180" />, text: 'text-emerald-400', label: '↓ FALLING' },
    stable: { icon: <Radio className="w-3 h-3" />, text: 'text-blue-400', label: '→ STABLE' },
    unknown: { icon: <Radio className="w-3 h-3" />, text: 'text-zinc-500', label: '? UNKNOWN' },
  };
  const t = trendConfig[card.trend] || trendConfig.unknown;

  return (
    <div className="rounded-xl border border-blue-500/20 bg-gradient-to-br from-blue-950/30 to-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
            <TrendingUp className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Forecast Intelligence</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${t.text} bg-black/30`}>
          {t.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="flex items-center gap-2">
          <Wind className="w-3.5 h-3.5 text-zinc-500" />
          <div>
            <div className="text-sm font-medium text-zinc-200">
              {card.wind_speed != null ? `${card.wind_speed} m/s` : '—'}
            </div>
            <div className="text-[10px] text-zinc-500">Wind speed</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-zinc-500" />
          <div>
            <div className="text-sm font-medium text-zinc-200">{card.alert_count || 0}</div>
            <div className="text-[10px] text-zinc-500">Active alerts</div>
          </div>
        </div>
      </div>
      {card.summary && (
        <p className="mt-3 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{card.summary}</p>
      )}
    </div>
  );
}

function ComplianceCard({ card }: { card: MissionCard }) {
  const cls = CLASSIFICATION_CONFIG[card.classification] || CLASSIFICATION_CONFIG.advisory;
  return (
    <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/30 to-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Regulatory Compliance</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${cls.bg} ${cls.text}`}>
          {cls.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-black/20">
          <span className={`text-[10px] font-bold ${card.cpcb_status === 'EXCEEDED' ? 'text-rose-400' : 'text-emerald-400'}`}>
            CPCB
          </span>
          <span className="text-[10px] text-zinc-400">{card.cpcb_status}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-black/20">
          <span className={`text-[10px] font-bold ${card.who_status === 'EXCEEDED' ? 'text-rose-400' : 'text-emerald-400'}`}>
            WHO
          </span>
          <span className="text-[10px] text-zinc-400">{card.who_status}</span>
        </div>
      </div>
      {card.recommended_actions && card.recommended_actions.length > 0 && (
        <div className="mt-3 space-y-1">
          <span className="text-[10px] text-zinc-500 uppercase font-bold">Actions</span>
          {card.recommended_actions.slice(0, 3).map((action: string, i: number) => (
            <div key={i} className="text-[11px] text-zinc-400 leading-snug pl-1">
              {action}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DroneCard({ card }: { card: MissionCard }) {
  const StatusDot = ({ ok }: { ok: boolean }) =>
    ok ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-rose-400" />;

  return (
    <div className="rounded-xl border border-teal-500/20 bg-gradient-to-br from-teal-950/30 to-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400">
            <Plane className="w-4 h-4" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Drone Reconnaissance</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${card.deploy ? 'text-emerald-400 bg-emerald-500/15' : 'text-rose-400 bg-rose-500/15'}`}>
          {card.deploy ? 'GO' : 'NO-GO'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <StatusDot ok={card.vlos_ok} /> <Eye className="w-3 h-3 text-zinc-500" /> VLOS
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <StatusDot ok={card.airspace_ok} /> <Shield className="w-3 h-3 text-zinc-500" /> Airspace
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <StatusDot ok={card.battery_ok} /> <Battery className="w-3 h-3 text-zinc-500" /> Battery
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <StatusDot ok={card.weather_ok} /> <Wind className="w-3 h-3 text-zinc-500" /> Weather
        </div>
      </div>
      {card.flight_plan_count > 0 && (
        <div className="mt-2 text-[11px] text-zinc-500">
          {card.flight_plan_count} flight plan{card.flight_plan_count > 1 ? 's' : ''} generated
        </div>
      )}
      {card.summary && (
        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{card.summary}</p>
      )}
    </div>
  );
}

function ReportCard({ card }: { card: MissionCard }) {
  return (
    <div className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-950/30 to-zinc-900/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400">
          <FileText className="w-4 h-4" />
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Documentation</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-bold">
          {card.report_type === 'auto_generated_hazardous' ? 'AUTO-GENERATED' : 'GENERATED'}
        </span>
      </div>
      {card.summary && <p className="text-xs text-zinc-400 leading-relaxed">{card.summary}</p>}
    </div>
  );
}

/* ── Pipeline visualiser ───────────────────────────────────────────────────── */

function PipelineBar({ specialists }: { specialists: string[] }) {
  const allNodes = ['analysis', 'forecast', 'compliance', 'drone', 'report'];
  return (
    <div className="flex items-center gap-1 mb-3">
      <div className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
        {allNodes.map((node, i) => {
          const active = specialists.includes(node);
          return (
            <React.Fragment key={node}>
              {i > 0 && <div className="w-3 h-px bg-zinc-700" />}
              <div
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${
                  active
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                    : 'text-zinc-600'
                }`}
              >
                {node.slice(0, 4)}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {specialists.length > 0 && (
        <span className="text-[9px] text-zinc-600 ml-1">{specialists.length} agent{specialists.length > 1 ? 's' : ''} active</span>
      )}
    </div>
  );
}

/* ── Trigger badges ────────────────────────────────────────────────────────── */

function TriggerBadges({ triggers }: { triggers: string[] }) {
  if (!triggers.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {triggers.map((t) => (
        <div key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
          <Zap className="w-2.5 h-2.5 text-amber-400" />
          <span className="text-[9px] font-mono text-amber-400">{t.replace(/_/g, ' ')}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main export ───────────────────────────────────────────────────────────── */

export default function MissionCards({
  cards,
  riskLevel,
  activeSpecialists = [],
  autonomousTriggers = [],
}: MissionCardsProps) {
  if (!cards || cards.length === 0) return null;

  const CARD_RENDERERS: Record<string, React.ComponentType<{ card: MissionCard }>> = {
    status: StatusCard,
    analysis: AnalysisAgentCard,
    forecast: ForecastCard,
    compliance: ComplianceCard,
    drone: DroneCard,
    report: ReportCard,
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Pipeline visualiser */}
      {activeSpecialists.length > 0 && <PipelineBar specialists={activeSpecialists} />}

      {/* Autonomous triggers */}
      {autonomousTriggers.length > 0 && <TriggerBadges triggers={autonomousTriggers} />}

      {/* Cards */}
      {cards.map((card, i) => {
        const Renderer = CARD_RENDERERS[card.type];
        if (!Renderer) return null;
        return <Renderer key={`${card.type}-${i}`} card={card as MissionCard} />;
      })}
    </div>
  );
}
