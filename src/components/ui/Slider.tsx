/**
 * Reusable Slider component for numeric input.
 * @module components/ui/Slider
 */

import React from 'react';

export interface SliderProps {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  className?: string;
}

/**
 * Range input slider with label and value display
 */
export function Slider({
  label,
  min,
  max,
  value,
  step = 1,
  onChange,
  formatValue,
  className = '',
}: SliderProps) {
  const displayValue = formatValue ? formatValue(value) : value.toFixed(2);
  
  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-blue-600"
      />
    </div>
  );
}
