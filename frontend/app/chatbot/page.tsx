'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import Navbar from '../components/Navbar';
import ChatWindow from './_components/ChatWindow';
import RequestForm from './_components/RequestForm';
import SuggestedPrompts from './_components/SuggestedPrompts';
import { Bot, FileText, Sparkles, ArrowRight, Shield, Upload } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  intent?: string;
  executedTools?: string[];
  artifacts?: Array<{
    type: string;
    url?: string;
    data?: any;
    location?: string;
    date?: string;
    bbox?: string;
  }>;
  status?: string;
  isLoading?: boolean;
}

export interface FormData {
  organization: string;
  role: string;
  location: string;
  bbox: string;
  observation_date: string;
  forecast_duration: number | '';
  requested_tasks: string[];
  additional_notes: string;
  language: string;
}

export default function ChatbotPage() {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const landingFileInputRef = useRef<HTMLInputElement>(null);

  // Generate session ID on mount
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
    return h;
  }, [session]);

  const sendMessage = useCallback(
    async (text: string, formData?: Partial<FormData>) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date(),
      };

      const loadingMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isLoading: true,
        status: 'thinking',
      };

      setMessages((prev) => [...prev, userMsg, loadingMsg]);
      setIsLoading(true);
      setHasStarted(true);

      try {
        const body: Record<string, unknown> = {
          message: text,
          session_id: sessionId,
        };

        if (formData) {
          Object.entries(formData).forEach(([k, v]) => {
            if (v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) {
              body[k] = v;
            }
          });
        }

        const res = await fetch(`${API_BASE}/api/v1/agent/chat`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        const data = await res.json();

        if (data.session_id) setSessionId(data.session_id);

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.response || data.follow_up_question || 'No response from agent.',
          timestamp: new Date(),
          intent: data.intent,
          executedTools: data.executed_tools,
          artifacts: data.artifacts,
          status: data.status,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === loadingMsg.id ? assistantMsg : m))
        );
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`,
          timestamp: new Date(),
          status: 'error',
        };
        setMessages((prev) =>
          prev.map((m) => (m.id === loadingMsg.id ? errorMsg : m))
        );
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, authHeaders]
  );

  const handleFormSubmit = useCallback(
    (formData: FormData) => {
      const parts: string[] = [];
      if (formData.organization) parts.push(`Organization: ${formData.organization}`);
      if (formData.role) parts.push(`Role: ${formData.role}`);
      if (formData.location) parts.push(`Location: ${formData.location}`);
      if (formData.observation_date) parts.push(`Date: ${formData.observation_date}`);
      if (formData.forecast_duration) parts.push(`Forecast: ${formData.forecast_duration}h`);
      if (formData.requested_tasks.length > 0) parts.push(`Tasks: ${formData.requested_tasks.join(', ')}`);
      if (formData.additional_notes) parts.push(`Notes: ${formData.additional_notes}`);

      const text = parts.length > 0
        ? `Request Form Submission:\n${parts.join('\n')}\n\nPlease proceed with the analysis.`
        : 'Please proceed with the analysis.';

      setShowForm(false);
      sendMessage(text, formData);
    },
    [sendMessage]
  );

  const handleDocxUpload = useCallback(
    async (file: File) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: `📎 Uploaded form: **${file.name}**`,
        timestamp: new Date(),
      };

      const loadingMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isLoading: true,
        status: 'thinking',
      };

      setMessages((prev) => [...prev, userMsg, loadingMsg]);
      setIsLoading(true);
      setHasStarted(true);

      try {
        const formData = new FormData();
        formData.append('file', file);
        if (sessionId) formData.append('session_id', sessionId);

        const headers: Record<string, string> = {};
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

        const res = await fetch(`${API_BASE}/api/v1/agent/upload-form`, {
          method: 'POST',
          headers,
          body: formData,
        });

        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

        const data = await res.json();
        if (data.session_id) setSessionId(data.session_id);

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.response || data.follow_up_question || 'Document processed.',
          timestamp: new Date(),
          intent: data.intent,
          executedTools: data.executed_tools,
          artifacts: data.artifacts,
          status: data.status,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === loadingMsg.id ? assistantMsg : m))
        );
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ Could not process the document: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date(),
          status: 'error',
        };
        setMessages((prev) =>
          prev.map((m) => (m.id === loadingMsg.id ? errorMsg : m))
        );
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, session]
  );

  const handleLoadServerForm = useCallback(async () => {
    setIsLoading(true);
    setHasStarted(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: '📄 Attached `backend/data/NO2_Air_Quality_Analysis_Request_Form.docx`',
      timestamp: new Date(),
    };

    const loadingMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);

    try {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(
        `${API_BASE}/api/v1/agent/load-server-form?session_id=${encodeURIComponent(sessionId)}`,
        {
          method: 'POST',
          headers,
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server form error: ${res.statusText}`);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response || data.follow_up_question || 'Form attached.',
        timestamp: new Date(),
        intent: data.intent,
        executedTools: data.executed_tools,
        artifacts: data.artifacts,
        status: data.status,
      };

      setMessages((prev) =>
        prev.map((m) => (m.id === loadingMsg.id ? assistantMsg : m))
      );
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ Could not load server form: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
        status: 'error',
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === loadingMsg.id ? errorMsg : m))
      );
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, session]);

  const handleStartAnalysis = useCallback(() => {
    setHasStarted(true);
    sendMessage('Hello');
  }, [sendMessage]);

  // ── Landing view (before first message) ───────────────────────────────
  if (!hasStarted) {
    return (
      <div className="flex flex-col h-full">
        <Navbar />
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          {/* Animated background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/3 rounded-full blur-3xl" />
          </div>

          <div className="relative z-10 max-w-2xl w-full mx-auto px-6 text-center">
            {/* Logo */}
            <div className="flex justify-center mb-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 flex items-center justify-center backdrop-blur-sm">
                <Bot className="w-10 h-10 text-blue-400" />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">
              Environmental Intelligence
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                Analysis Portal
              </span>
            </h1>

            <p className="text-[#9da5b7] text-sm sm:text-base mb-10 max-w-lg mx-auto leading-relaxed">
              AI-powered satellite NO₂ analysis for researchers and government agencies.
              Downscale maps, forecast trends, generate reports, and identify pollution hotspots.
            </p>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3 mb-12">
              <button
                onClick={handleStartAnalysis}
                className="group flex items-center gap-2.5 px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold text-sm shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Start Analysis
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>

              <button
                onClick={handleLoadServerForm}
                className="flex items-center gap-2.5 px-5 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-semibold text-sm transition-all"
              >
                <FileText className="w-4 h-4" />
                Attach NO₂ Request Form
              </button>

              <button
                onClick={() => landingFileInputRef.current?.click()}
                className="flex items-center gap-2.5 px-5 py-3 rounded-xl border border-[#2e3547] bg-[#141721] hover:bg-[#1b202e] hover:border-[#3b4257] text-zinc-300 font-semibold text-sm transition-all"
              >
                <Upload className="w-4 h-4 text-blue-400" />
                Browse File
              </button>

              <button
                onClick={() => { setShowForm(true); setHasStarted(true); }}
                className="flex items-center gap-2.5 px-5 py-3 rounded-xl border border-[#2e3547] bg-[#141721] hover:bg-[#1b202e] hover:border-[#3b4257] text-zinc-300 font-semibold text-sm transition-all"
              >
                <FileText className="w-4 h-4" />
                Use Request Form
              </button>

              <input
                ref={landingFileInputRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setHasStarted(true);
                    handleDocxUpload(file);
                  }
                  e.target.value = '';
                }}
              />
            </div>

            {/* Suggested prompts */}
            <SuggestedPrompts onSelect={(text) => { setHasStarted(true); sendMessage(text); }} />

            {/* Trust badge */}
            <div className="mt-10 flex items-center justify-center gap-2 text-xs text-[#5e6678]">
              <Shield className="w-3.5 h-3.5" />
              <span>Government-grade environmental analysis • Session data not stored</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat view ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <Navbar />
      <div className="flex-1 min-h-0 flex">
        {/* Form sidebar */}
        {showForm && (
          <div className="w-[420px] shrink-0 border-r border-[#242938] bg-[#11141d] overflow-y-auto">
            <RequestForm
              onSubmit={handleFormSubmit}
              onClose={() => setShowForm(false)}
              onUploadDocx={handleDocxUpload}
            />
          </div>
        )}

        {/* Main chat area */}
        <div className="flex-1 min-w-0 flex flex-col">
          <ChatWindow
            messages={messages}
            isLoading={isLoading}
            onSendMessage={sendMessage}
            onToggleForm={() => setShowForm(!showForm)}
            showFormButton={!showForm}
            onUploadDocx={handleDocxUpload}
            onLoadServerForm={handleLoadServerForm}
          />
        </div>
      </div>
    </div>
  );
}
