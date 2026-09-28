'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, FileText, Upload, Paperclip, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import type { ChatMessage } from '../page';
import MessageBubble from './MessageBubble';
import { PRESET_QUERIES } from './SuggestedPrompts';

interface ChatWindowProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (text: string) => void;
  onToggleForm: () => void;
  showFormButton: boolean;
  onUploadDocx: (file: File) => void;
  onLoadServerForm?: () => void;
}

export default function ChatWindow({
  messages,
  isLoading,
  onSendMessage,
  onToggleForm,
  showFormButton,
  onUploadDocx,
  onLoadServerForm,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [showPresetQuestions, setShowPresetQuestions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [isLoading]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || isLoading) return;
      setInput('');
      onSendMessage(text);
    },
    [input, isLoading, onSendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onUploadDocx(file);
        e.target.value = '';
      }
    },
    [onUploadDocx]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="shrink-0 min-h-12 py-2 px-4 border-b border-[#242938] bg-[#11141d] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-zinc-300">AirQ Insight Agent</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            ONLINE
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Preset Questions Toggle Button */}
          <button
            type="button"
            onClick={() => setShowPresetQuestions((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm ${
              showPresetQuestions
                ? 'bg-blue-600 text-white border border-blue-500 shadow-blue-500/25 ring-1 ring-blue-400/40'
                : 'bg-[#181d2a] hover:bg-[#202738] border border-[#2e3547] hover:border-blue-500/50 text-zinc-200 hover:text-white'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${showPresetQuestions ? 'text-amber-300' : 'text-amber-400'}`} />
            <span>Preset Questions</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              showPresetQuestions ? 'bg-blue-700 text-blue-100' : 'bg-[#222838] text-zinc-400'
            }`}>
              {PRESET_QUERIES.length}
            </span>
            {showPresetQuestions ? (
              <ChevronUp className="w-3.5 h-3.5 text-blue-200" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            )}
          </button>

          {onLoadServerForm && (
            <button
              onClick={onLoadServerForm}
              disabled={isLoading}
              title="Load backend/data/NO2_Air_Quality_Analysis_Request_Form.docx"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-all disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              Attach NO₂ Request Form
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-[#1b202e] hover:bg-[#23293b] border border-[#2e3547] transition-all disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5 text-blue-400" />
            Browse File
          </button>

          {showFormButton && (
            <button
              onClick={onToggleForm}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-[#1b202e] border border-[#242938] hover:border-[#3b4257] transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
              Request Form
            </button>
          )}
        </div>
      </div>

      {/* Preset Questions Collapsible Card */}
      {showPresetQuestions && (
        <div className="shrink-0 p-3 bg-[#111520] border-b border-[#242938] shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              Preset Intelligence Inquiries
            </span>
            <span className="text-[10px] text-zinc-500">Select to send immediately</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            {PRESET_QUERIES.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  setShowPresetQuestions(false);
                  onSendMessage(q.query);
                }}
                disabled={isLoading}
                className="flex items-start gap-2 p-2 rounded-lg bg-[#161b29] hover:bg-[#1e2538] border border-[#272f44] hover:border-blue-500/50 text-left transition-all cursor-pointer group shadow-sm disabled:opacity-50"
              >
                <div className="p-1 rounded bg-blue-600/15 border border-blue-500/20 text-blue-400 group-hover:bg-blue-600/30 group-hover:text-blue-300 shrink-0 mt-0.5">
                  {q.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs text-zinc-200 group-hover:text-white truncate">
                    {q.label}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {q.query}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-[#5e6678] text-sm">
              <p>Start typing a message or use the Request Form.</p>
              <p className="mt-1 text-xs">Example: &quot;Forecast air quality in Mumbai for 6 hours&quot;</p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-[#242938] bg-[#11141d] p-3">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          {/* File upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 w-9 h-9 rounded-lg bg-[#1b202e] border border-[#242938] hover:border-[#3b4257] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-all"
            title="Upload .docx form"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about air quality, request a map, forecast, or report..."
              rows={1}
              disabled={isLoading}
              className="w-full resize-none rounded-xl bg-[#141721] border border-[#2e3547] focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 px-4 py-2.5 text-sm text-white placeholder:text-[#5e6678] outline-none transition-all disabled:opacity-50"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
          </div>

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="shrink-0 w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-[#1b202e] disabled:border disabled:border-[#242938] flex items-center justify-center text-white disabled:text-[#5e6678] transition-all shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
