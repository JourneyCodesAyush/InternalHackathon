'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

export interface DatePickerProps {
  availableDates: string[]; // List of YYYY-MM-DD
  selectedDate: string;     // Currently selected YYYY-MM-DD
  onDateChange: (date: string) => void;
  isLoading?: boolean;
  dropUp?: boolean;
  align?: 'left' | 'center' | 'right';
  variant?: 'button' | 'inline';
}

export default function DatePicker({
  availableDates,
  selectedDate,
  onDateChange,
  isLoading = false,
  dropUp = false,
  align = 'left',
  variant = 'button',
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Set of fast lookup for available dates
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);

  // Current calendar view month (defaults to selected date's month or first available)
  const [viewYear, setViewYear] = useState<number>(() => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      if (!isNaN(d.getTime())) return d.getUTCFullYear();
    }
    return 2025;
  });

  const [viewMonth, setViewMonth] = useState<number>(() => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      if (!isNaN(d.getTime())) return d.getUTCMonth();
    }
    return 10; // November (0-indexed)
  });

  // Sync calendar view when selectedDate changes from outside
  useEffect(() => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      if (!isNaN(d.getTime())) {
        setViewYear(d.getUTCFullYear());
        setViewMonth(d.getUTCMonth());
      }
    }
  }, [selectedDate]);

  // Close calendar popup when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Format month and year label
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const viewMonthLabel = `${monthNames[viewMonth]} ${viewYear}`;

  // Calendar days grid calculation
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startingDayOfWeek = firstDayOfMonth.getUTCDay(); // 0 for Sunday
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

    const days: Array<{
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isAvailable: boolean;
      isSelected: boolean;
    }> = [];

    // Preceding empty / disabled days from previous month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push({
        dateStr: '',
        dayNumber: 0,
        isCurrentMonth: false,
        isAvailable: false,
        isSelected: false,
      });
    }

    // Days of current view month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isAvailable = availableSet.has(dateStr);
      const isSelected = dateStr === selectedDate;
      days.push({
        dateStr,
        dayNumber: d,
        isCurrentMonth: true,
        isAvailable,
        isSelected,
      });
    }

    return days;
  }, [viewYear, viewMonth, availableSet, selectedDate]);

  // Navigation handlers
  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Formatted date string for input display: "05 Nov 2025"
  const formattedDisplay = useMemo(() => {
    if (!selectedDate) return 'Select date...';
    try {
      const d = new Date(selectedDate);
      if (isNaN(d.getTime())) return selectedDate;
      const day = String(d.getUTCDate()).padStart(2, '0');
      const mon = monthNames[d.getUTCMonth()].slice(0, 3);
      const yr = d.getUTCFullYear();
      return `${day} ${mon} ${yr}`;
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  // Alignment classes
  const alignmentClass =
    align === 'center'
      ? 'left-1/2 -translate-x-1/2'
      : align === 'right'
      ? 'right-0'
      : 'left-0';

  const positionClass = dropUp
    ? `bottom-full mb-2 origin-bottom ${alignmentClass}`
    : `top-full mt-1.5 origin-top ${alignmentClass}`;

  return (
    <div ref={containerRef} className="relative inline-block text-left select-none">
      {/* Date Filling Form Trigger Button */}
      {variant === 'inline' ? (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#161a26] hover:bg-[#1f2538] text-zinc-200 hover:text-white border border-[#2b3247] hover:border-blue-500/60 text-xs font-mono font-medium shadow-sm transition-all cursor-pointer group"
          aria-label="Change observation date"
          title="Click to change date from available satellite datasets"
        >
          <CalendarIcon className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-300 transition-colors shrink-0" />
          <span className="font-semibold text-white tracking-wide">{formattedDisplay}</span>
          {isLoading && (
            <span className="w-2 h-2 rounded-full border-2 border-blue-400/40 border-t-blue-400 animate-spin shrink-0" />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1a2030] text-zinc-200 border border-[#242938] hover:border-blue-500/50 text-xs font-medium shadow-md transition-all cursor-pointer group"
          aria-label="Choose observation date"
          title="Choose date from available satellite datasets"
        >
          <CalendarIcon className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-300 transition-colors" />
          <span className="font-mono text-zinc-100 font-semibold">{formattedDisplay}</span>
          {isLoading && (
            <span className="w-2.5 h-2.5 rounded-full border-2 border-blue-400/40 border-t-blue-400 animate-spin" />
          )}
        </button>
      )}

      {/* Floating Small Calendar Modal */}
      {isOpen && (
        <div
          className={`absolute ${positionClass} z-50 w-64 bg-[#11141d]/98 backdrop-blur-xl border border-[#2b3247] rounded-xl p-3 shadow-[0_12px_36px_rgba(0,0,0,0.85)] text-[#f1f3f7] animate-in fade-in zoom-in-95 duration-100`}
        >
          {/* Calendar Header with Month/Year & Navigation */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#242938]">
            <span className="text-xs font-semibold text-zinc-200">{viewMonthLabel}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1 rounded hover:bg-[#1f2538] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Previous month"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1 rounded hover:bg-[#1f2538] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Next month"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Weekday Labels (Su, Mo, Tu, We, Th, Fr, Sa) */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
              <span key={day} className="text-[10px] font-mono text-zinc-500 font-medium">
                {day}
              </span>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {calendarDays.map((item, idx) => {
              if (!item.isCurrentMonth) {
                return <div key={`empty-${idx}`} className="w-7 h-7" />;
              }

              const isEnabled = item.isAvailable;

              return (
                <button
                  key={item.dateStr}
                  type="button"
                  disabled={!isEnabled}
                  onClick={() => {
                    if (isEnabled) {
                      onDateChange(item.dateStr);
                      setIsOpen(false);
                    }
                  }}
                  className={`w-7 h-7 flex items-center justify-center rounded-md text-xs font-mono transition-all ${
                    item.isSelected
                      ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/40 ring-1 ring-blue-400'
                      : isEnabled
                      ? 'text-zinc-200 hover:bg-blue-600/25 hover:text-blue-200 font-medium cursor-pointer border border-blue-500/20'
                      : 'text-zinc-600 opacity-40 cursor-not-allowed bg-transparent'
                  }`}
                  title={
                    isEnabled
                      ? `Select data for ${item.dateStr}`
                      : `No uploaded satellite data for ${item.dateStr}`
                  }
                >
                  {item.dayNumber}
                </button>
              );
            })}
          </div>

          {/* Legend / Info Footer */}
          <div className="mt-2.5 pt-2 border-t border-[#242938] flex items-center justify-between text-[10px] text-zinc-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-blue-500/30 border border-blue-500/60" />
              <span>Available ({availableDates.length} days)</span>
            </div>
            <span className="font-mono text-zinc-500">test_data</span>
          </div>
        </div>
      )}
    </div>
  );
}
