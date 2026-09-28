'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, FileText, Upload, Paperclip } from 'lucide-react';
import type { ChatMessage } from '../page';
import MessageBubble from './MessageBubble';

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
