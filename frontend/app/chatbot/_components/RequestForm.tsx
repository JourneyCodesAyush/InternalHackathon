'use client';

import React, { useState, useCallback, useRef } from 'react';
import { X, Send, Upload, Building2, MapPin, Calendar, Clock, ListChecks, Globe2, StickyNote } from 'lucide-react';
import type { FormData } from '../page';

interface RequestFormProps {
  onSubmit: (data: FormData) => void;
  onClose: () => void;
  onUploadDocx: (file: File) => void;
}

const AVAILABLE_TASKS = [
  { id: 'downscale', label: 'Downscale NO₂ Map', icon: '🗺️' },
  { id: 'forecast', label: 'Forecast Trends', icon: '📈' },
  { id: 'report', label: 'Generate Report', icon: '📄' },
  { id: 'hotspot', label: 'Hotspot Analysis', icon: '🔍' },
  { id: 'analysis', label: 'Regulatory Analysis', icon: '📊' },
];

const PRESET_LOCATIONS = [
  { name: 'Mumbai', bbox: '72.77,18.88,73.12,19.32' },
  { name: 'Delhi', bbox: '76.84,28.40,77.35,28.88' },
  { name: 'Bangalore', bbox: '77.46,12.83,77.78,13.14' },
  { name: 'Chennai', bbox: '80.15,12.90,80.32,13.22' },
  { name: 'Hyderabad', bbox: '78.30,17.30,78.60,17.55' },
  { name: 'Kolkata', bbox: '88.25,22.45,88.48,22.65' },
  { name: 'Pune', bbox: '73.75,18.43,73.99,18.63' },
  { name: 'Ahmedabad', bbox: '72.50,22.95,72.70,23.12' },
];

export default function RequestForm({ onSubmit, onClose, onUploadDocx }: RequestFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormData>({
    organization: '',
    role: '',
    location: '',
    bbox: '',
    observation_date: '',
    forecast_duration: '',
    requested_tasks: [],
    additional_notes: '',
    language: 'en',
  });

  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleTask = useCallback((taskId: string) => {
    setForm((prev) => ({
      ...prev,
      requested_tasks: prev.requested_tasks.includes(taskId)
        ? prev.requested_tasks.filter((t) => t !== taskId)
        : [...prev.requested_tasks, taskId],
    }));
  }, []);

  const selectPresetLocation = useCallback((name: string, bbox: string) => {
    setForm((prev) => ({ ...prev, location: name, bbox }));
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onUploadDocx(file);
        onClose();
      }
    },
    [onUploadDocx, onClose]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit(form);
    },
    [form, onSubmit]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[#242938] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Analysis Request Form</h2>
          <p className="text-[10px] text-[#5e6678] mt-0.5">Fill in details for structured analysis</p>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg hover:bg-[#1b202e] flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* DOCX Upload shortcut */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[#2e3547] hover:border-blue-500/40 bg-[#141721] hover:bg-blue-500/5 text-zinc-400 hover:text-blue-300 text-xs font-medium transition-all"
        >
          <Upload className="w-4 h-4" />
          Upload .docx Request Form
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={handleFileUpload}
        />

        <div className="h-px bg-[#242938]" />

        {/* Organization */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <Building2 className="w-3.5 h-3.5" /> Organization
          </label>
          <input
            type="text"
            value={form.organization}
            onChange={(e) => updateField('organization', e.target.value)}
            placeholder="e.g., CPCB, State Pollution Board"
            className="w-full px-3 py-2 rounded-lg bg-[#141721] border border-[#2e3547] focus:border-blue-500/50 text-sm text-white placeholder:text-[#5e6678] outline-none transition-colors"
          />
        </div>

        {/* Role */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <Building2 className="w-3.5 h-3.5" /> Role / Designation
          </label>
          <input
            type="text"
            value={form.role}
            onChange={(e) => updateField('role', e.target.value)}
            placeholder="e.g., Environmental Scientist, AQI Analyst"
            className="w-full px-3 py-2 rounded-lg bg-[#141721] border border-[#2e3547] focus:border-blue-500/50 text-sm text-white placeholder:text-[#5e6678] outline-none transition-colors"
          />
        </div>

        {/* Location */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <MapPin className="w-3.5 h-3.5" /> Location
          </label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => updateField('location', e.target.value)}
            placeholder="City or region name"
            className="w-full px-3 py-2 rounded-lg bg-[#141721] border border-[#2e3547] focus:border-blue-500/50 text-sm text-white placeholder:text-[#5e6678] outline-none transition-colors mb-2"
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESET_LOCATIONS.map(({ name, bbox }) => (
              <button
                key={name}
                type="button"
                onClick={() => selectPresetLocation(name, bbox)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-all ${
                  form.location === name
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    : 'bg-[#141721] border-[#2e3547] text-zinc-500 hover:text-zinc-300 hover:border-[#3b4257]'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Bounding Box */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <MapPin className="w-3.5 h-3.5" /> Bounding Box
          </label>
          <input
            type="text"
            value={form.bbox}
            onChange={(e) => updateField('bbox', e.target.value)}
            placeholder="west,south,east,north (e.g., 72.77,18.88,73.12,19.32)"
            className="w-full px-3 py-2 rounded-lg bg-[#141721] border border-[#2e3547] focus:border-blue-500/50 text-sm text-white placeholder:text-[#5e6678] outline-none transition-colors font-mono text-xs"
          />
        </div>

        {/* Date */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <Calendar className="w-3.5 h-3.5" /> Observation Date
          </label>
          <input
            type="date"
            value={form.observation_date}
            onChange={(e) => updateField('observation_date', e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#141721] border border-[#2e3547] focus:border-blue-500/50 text-sm text-white outline-none transition-colors [color-scheme:dark]"
          />
        </div>

        {/* Forecast Duration */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <Clock className="w-3.5 h-3.5" /> Forecast Duration (hours)
          </label>
          <div className="flex gap-2">
            {[3, 6, 12, 24].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => updateField('forecast_duration', h)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                  form.forecast_duration === h
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    : 'bg-[#141721] border-[#2e3547] text-zinc-500 hover:text-zinc-300 hover:border-[#3b4257]'
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
        </div>

        {/* Requested Tasks */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <ListChecks className="w-3.5 h-3.5" /> Requested Tasks
          </label>
          <div className="space-y-1.5">
            {AVAILABLE_TASKS.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleTask(id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left ${
                  form.requested_tasks.includes(id)
                    ? 'bg-blue-500/15 border-blue-500/35 text-blue-200'
                    : 'bg-[#141721] border-[#2e3547] text-zinc-400 hover:text-zinc-200 hover:border-[#3b4257]'
                }`}
              >
                <span>{icon}</span>
                <span>{label}</span>
                {form.requested_tasks.includes(id) && (
                  <span className="ml-auto text-blue-400 text-[10px]">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <Globe2 className="w-3.5 h-3.5" /> Report Language
          </label>
          <div className="flex gap-2">
            {[
              { id: 'en', label: 'English' },
              { id: 'hi', label: 'हिन्दी' },
              { id: 'mr', label: 'मराठी' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => updateField('language', id)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                  form.language === id
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    : 'bg-[#141721] border-[#2e3547] text-zinc-500 hover:text-zinc-300 hover:border-[#3b4257]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Additional Notes */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
            <StickyNote className="w-3.5 h-3.5" /> Additional Notes
          </label>
          <textarea
            value={form.additional_notes}
            onChange={(e) => updateField('additional_notes', e.target.value)}
            placeholder="Any specific requirements or context..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-[#141721] border border-[#2e3547] focus:border-blue-500/50 text-sm text-white placeholder:text-[#5e6678] outline-none transition-colors resize-none"
          />
        </div>
      </form>

      {/* Submit button */}
      <div className="shrink-0 px-4 py-3 border-t border-[#242938]">
        <button
          onClick={handleSubmit as unknown as React.MouseEventHandler}
          disabled={form.requested_tasks.length === 0 && !form.location}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-[#1b202e] disabled:to-[#1b202e] disabled:border disabled:border-[#2e3547] text-white disabled:text-[#5e6678] text-sm font-semibold transition-all shadow-sm"
        >
          <Send className="w-4 h-4" />
          Submit Analysis Request
        </button>
      </div>
    </div>
  );
}
