'use client';

import React from 'react';
import { Bot, User, MapPin, BarChart3, FileText, Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ChatMessage } from '../page';
import AnalysisCard from './AnalysisCard';
import MissionCards from './MissionCards';

const TOOL_ICONS: Record<string, React.ReactNode> = {
  downscale: <MapPin className="w-3 h-3" />,
  forecast: <BarChart3 className="w-3 h-3" />,
  report: <FileText className="w-3 h-3" />,
  hotspot: <Search className="w-3 h-3" />,
  analysis: <BarChart3 className="w-3 h-3" />,
};

const TOOL_LABELS: Record<string, string> = {
  downscale: 'Downscale Map',
  forecast: 'Forecast',
  report: 'Report',
  hotspot: 'Hotspot Analysis',
  analysis: 'Area Analysis',
};

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  // Loading state
  if (message.isLoading) {
    return (
      <div className="flex items-start gap-3 py-3">
        <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 flex items-center justify-center">
          <Bot className="w-4 h-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-blue-400">AirQ Agent</span>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
              <span className="text-[10px] font-mono text-amber-400">
                {message.status === 'executing' ? 'Executing tools...' : 'Analyzing...'}
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            <div className="w-2 h-2 bg-blue-500/40 rounded-full animate-bounce" />
            <div className="w-2 h-2 bg-blue-500/40 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
            <div className="w-2 h-2 bg-blue-500/40 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        </div>
      </div>
    );
  }

  // User message
  if (isUser) {
    return (
      <div className="flex items-start gap-3 py-3 justify-end">
        <div className="max-w-[75%] min-w-0">
          <div className="bg-blue-600/20 border border-blue-500/25 rounded-2xl rounded-tr-sm px-4 py-2.5">
            <p className="text-sm text-zinc-100 whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          </div>
          <div className="text-right mt-1">
            <span className="text-[10px] text-[#5e6678]">
              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        <div className="shrink-0 w-8 h-8 rounded-lg bg-[#1b202e] border border-[#2e3547] flex items-center justify-center">
          <User className="w-4 h-4 text-zinc-400" />
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 flex items-center justify-center">
        <Bot className="w-4 h-4 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0 max-w-[85%]">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-medium text-blue-400">AirQ Agent</span>
          {message.intent && message.intent !== 'greeting' && message.intent !== 'help' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1b202e] border border-[#2e3547] text-[#9da5b7] font-mono">
              {message.intent}
            </span>
          )}
          {message.status === 'done' && message.executedTools && message.executedTools.length > 0 && (
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          )}
          {message.status === 'error' && (
            <AlertCircle className="w-3 h-3 text-red-400" />
          )}
        </div>

        {/* Executed tools badges */}
        {message.executedTools && message.executedTools.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {message.executedTools.map((tool) => (
              <div
                key={tool}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
              >
                {TOOL_ICONS[tool] || <CheckCircle2 className="w-3 h-3" />}
                <span className="text-[10px] font-medium">{TOOL_LABELS[tool] || tool}</span>
              </div>
            ))}
          </div>
        )}

        {/* Message content */}
        <div className="bg-[#141721] border border-[#242938] rounded-2xl rounded-tl-sm px-4 py-3">
          <div
            className="text-sm text-zinc-200 leading-relaxed prose-invert prose-sm prose-p:my-1.5 prose-headings:text-zinc-100 prose-headings:mt-3 prose-headings:mb-1.5 prose-strong:text-zinc-100 prose-ul:my-1.5 prose-li:my-0.5"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        </div>

        {/* Multi-agent Mission Cards */}
        {message.missionCards && message.missionCards.length > 0 && (
          <MissionCards
            cards={message.missionCards}
            riskLevel={message.riskLevel}
            activeSpecialists={message.activeSpecialists}
            autonomousTriggers={message.autonomousTriggers}
          />
        )}

        {/* Analysis & PDF Report Card */}
        {(() => {
          const reportArtifact = message.artifacts?.find(
            (a) => a.type === 'report' || a.type === 'analysis'
          );
          const hasReportTask =
            message.executedTools?.includes('report') ||
            message.executedTools?.includes('analysis') ||
            message.intent === 'report' ||
            message.intent === 'analysis';

          if (reportArtifact || hasReportTask) {
            const locMatch = message.content.match(/Results for ([^:\n]+)/i);
            const location =
              reportArtifact?.location ||
              (locMatch ? locMatch[1].trim() : 'Mumbai');

            return (
              <AnalysisCard
                location={location}
                date={reportArtifact?.date}
                bbox={reportArtifact?.bbox}
                data={reportArtifact?.data}
              />
            );
          }
          return null;
        })()}

        {/* Other Artifacts (Map / Forecast / Hotspots) */}
        {message.artifacts &&
          message.artifacts.filter((a) => a.type !== 'report' && a.type !== 'analysis').length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.artifacts
                .filter((a) => a.type !== 'report' && a.type !== 'analysis')
                .map((artifact, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-medium"
                  >
                    {artifact.type === 'map' && <MapPin className="w-3 h-3" />}
                    {artifact.type === 'forecast' && <BarChart3 className="w-3 h-3" />}
                    {artifact.type === 'hotspot' && <Search className="w-3 h-3" />}
                    <span className="capitalize">{artifact.type}</span>
                    {artifact.url && (
                      <a
                        href={artifact.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-blue-200"
                      >
                        View →
                      </a>
                    )}
                  </div>
                ))}
            </div>
          )}

        {/* Timestamp */}
        <div className="mt-1">
          <span className="text-[10px] text-[#5e6678]">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Ultra-simple Markdown → HTML renderer (no dependency needed).
 * Handles: bold, italic, headings, bullet lists, links, code, line breaks.
 */
function renderMarkdown(md: string): string {
  if (!md) return '';
  let html = md
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-[#1b202e] text-blue-300 text-xs">$1</code>')
    // Bullet lists
    .replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-blue-400 underline hover:text-blue-300">$1</a>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap in paragraph
  html = '<p>' + html + '</p>';

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>(?:\s*<br\/>?\s*)*)+/g, (match) => {
    return '<ul class="list-disc pl-5">' + match.replace(/<br\/?>/g, '') + '</ul>';
  });

  return html;
}
