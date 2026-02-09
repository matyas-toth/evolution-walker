/**
 * Fitness Chart Component
 * Displays best fitness per generation as a line chart.
 * @module components/ui/FitnessChart
 */

import React, { useState, useEffect } from 'react';

export interface FitnessDataPoint {
  generation: number;
  bestFitness: number;
}

export interface FitnessChartProps {
  data: FitnessDataPoint[];
  className?: string;
}

const CHART_HEIGHT = 180;
const PADDING = { top: 20, right: 40, bottom: 40, left: 60 };

/**
 * Fitness progression chart component
 * Shows best fitness value per generation as a line chart
 */
export function FitnessChart({ data, className = '' }: FitnessChartProps) {
  if (data.length === 0) {
    return (
      <div className={`${className} pointer-events-none`}>
        <svg
          width="100%"
          height={CHART_HEIGHT}
          viewBox={`0 0 800 ${CHART_HEIGHT}`}
          className="w-full"
        >
          <text
            x="400"
            y={CHART_HEIGHT / 2}
            textAnchor="middle"
            fill="#888"
            fontSize="14"
            fontFamily="sans-serif"
          >
            No data yet
          </text>
        </svg>
      </div>
    );
  }

  const maxGeneration = Math.max(...data.map((d) => d.generation));
  const maxFitness = Math.max(...data.map((d) => d.bestFitness));
  const minFitness = Math.min(...data.map((d) => d.bestFitness));
  
  // Add padding to Y-axis range to show negative values and provide visual padding
  const fitnessRange = maxFitness - minFitness;
  const yPadding = fitnessRange > 0 ? fitnessRange * 0.1 : Math.abs(minFitness) * 0.1 || 10;
  const yMin = minFitness - yPadding;
  const yMax = maxFitness + yPadding;
  const yRange = yMax - yMin;

  const [chartWidth, setChartWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 800
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setChartWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const plotWidth = chartWidth - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // Generate path for line
  const pathData = data
    .map((point, index) => {
      const x = PADDING.left + (point.generation / maxGeneration) * plotWidth;
      const y =
        PADDING.top +
        plotHeight -
        ((point.bestFitness - yMin) / yRange) * plotHeight;
      return `${index === 0 ? 'M' : 'L'} ${x},${y}`;
    })
    .join(' ');

  // Generate points for circles
  const points = data.map((point) => {
    const x = PADDING.left + (point.generation / maxGeneration) * plotWidth;
    const y =
      PADDING.top +
      plotHeight -
      ((point.bestFitness - yMin) / yRange) * plotHeight;
    return { x, y, fitness: point.bestFitness };
  });

  // Generate Y-axis ticks
  const yTicks = 5;
  const yTickValues: number[] = [];
  for (let i = 0; i <= yTicks; i++) {
    yTickValues.push(yMin + (yRange * i) / yTicks);
  }

  // Generate X-axis ticks (every 5 generations or so)
  const xTickInterval = Math.max(1, Math.ceil(maxGeneration / 10));
  const xTickValues: number[] = [];
  for (let i = 0; i <= maxGeneration; i += xTickInterval) {
    xTickValues.push(i);
  }

  return (
    <div className={`${className} pointer-events-none`}>
      <svg
        width="100%"
        height={CHART_HEIGHT}
        viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
        className="w-full"
        preserveAspectRatio="none"
      >
        {/* Grid lines */}
        {yTickValues.map((value, i) => {
          const y =
            PADDING.top +
            plotHeight -
            ((value - yMin) / yRange) * plotHeight;
          return (
            <line
              key={`grid-y-${i}`}
              x1={PADDING.left}
              y1={y}
              x2={PADDING.left + plotWidth}
              y2={y}
              stroke="#333"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
          );
        })}

        {/* Y-axis */}
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={PADDING.top + plotHeight}
          stroke="#666"
          strokeWidth="2"
        />

        {/* X-axis */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + plotHeight}
          x2={PADDING.left + plotWidth}
          y2={PADDING.top + plotHeight}
          stroke="#666"
          strokeWidth="2"
        />

        {/* Y-axis labels */}
        {yTickValues.map((value, i) => {
          const y =
            PADDING.top +
            plotHeight -
            ((value - yMin) / yRange) * plotHeight;
          return (
            <g key={`y-label-${i}`}>
              <line
                x1={PADDING.left - 5}
                y1={y}
                x2={PADDING.left}
                y2={y}
                stroke="#666"
                strokeWidth="1"
              />
              <text
                x={PADDING.left - 10}
                y={y + 4}
                textAnchor="end"
                fill="#aaa"
                fontSize="11"
                fontFamily="sans-serif"
              >
                {value.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xTickValues.map((value) => {
          const x = PADDING.left + (value / maxGeneration) * plotWidth;
          return (
            <g key={`x-label-${value}`}>
              <line
                x1={x}
                y1={PADDING.top + plotHeight}
                x2={x}
                y2={PADDING.top + plotHeight + 5}
                stroke="#666"
                strokeWidth="1"
              />
              <text
                x={x}
                y={PADDING.top + plotHeight + 20}
                textAnchor="middle"
                fill="#aaa"
                fontSize="11"
                fontFamily="sans-serif"
              >
                {value}
              </text>
            </g>
          );
        })}

        {/* Axis titles */}
        <text
          x={PADDING.left - 30}
          y={CHART_HEIGHT / 2}
          textAnchor="middle"
          fill="#ccc"
          fontSize="12"
          fontFamily="sans-serif"
          transform={`rotate(-90 ${PADDING.left - 30} ${CHART_HEIGHT / 2})`}
        >
          Fitness
        </text>
        <text
          x={PADDING.left + plotWidth / 2}
          y={CHART_HEIGHT - 10}
          textAnchor="middle"
          fill="#ccc"
          fontSize="12"
          fontFamily="sans-serif"
        >
          Generation
        </text>

        {/* Line path */}
        <path
          d={pathData}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {points.map((point, index) => (
          <circle
            key={`point-${index}`}
            cx={point.x}
            cy={point.y}
            r="3"
            fill="#22c55e"
            stroke="#fff"
            strokeWidth="1"
          />
        ))}
      </svg>
    </div>
  );
}
