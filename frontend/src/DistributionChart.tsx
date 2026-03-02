import { useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts';
import type { ConePoint } from './types';

interface DistributionChartProps {
  points: ConePoint[];
  currentPrice: number;
  horizon: string;
  targetLine?: number;
  highlightRange?: [number, number];
  queryMode?: 'above' | 'below' | 'between';
  liquidationPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
}

function formatChartPrice(price: number): string {
  if (price >= 10000) return `$${(price / 1000).toFixed(0)}k`;
  if (price >= 1000) return `$${price.toFixed(0)}`;
  if (price >= 1) return `$${price.toFixed(1)}`;
  return `$${price.toFixed(4)}`;
}

const BAND = '56, 189, 248'; // sky-400 RGB

export default function DistributionChart({
  points,
  currentPrice,
  horizon,
  targetLine,
  highlightRange,
  queryMode,
  liquidationPrice,
  takeProfit,
  stopLoss,
}: DistributionChartProps) {
  const { chartData, domain, xTicks } = useMemo(() => {
    if (!points.length) return { chartData: [], domain: [0, 1] as [number, number], xTicks: [] as number[] };

    // Subsample: every 4th point + always include last
    const sampled = points.filter((_, i) => i % 4 === 0 || i === points.length - 1);

    let minY = Infinity;
    let maxY = -Infinity;

    const data = sampled.map((p) => {
      if (p.p005 < minY) minY = p.p005;
      if (p.p995 > maxY) maxY = p.p995;
      return {
        time: p.hours_ahead,
        base: p.p005,
        b4l: p.p05 - p.p005,
        b3l: p.p20 - p.p05,
        b2l: p.p35 - p.p20,
        b1l: p.p50 - p.p35,
        b1h: p.p65 - p.p50,
        b2h: p.p80 - p.p65,
        b3h: p.p95 - p.p80,
        b4h: p.p995 - p.p95,
        median: p.p50,
      };
    });

    const padding = (maxY - minY) * 0.08;
    const dom: [number, number] = [minY - padding, maxY + padding];

    const ticks = horizon === '1h'
      ? [0, 0.25, 0.5, 0.75, 1]
      : [0, 6, 12, 18, 24];

    return { chartData: data, domain: dom, xTicks: ticks };
  }, [points, horizon]);

  if (!chartData.length) return null;

  const formatTime = (v: number): string => {
    if (horizon === '1h') {
      const m = Math.round(v * 60);
      return m === 0 ? 'Now' : `${m}m`;
    }
    return v === 0 ? 'Now' : `${Math.round(v)}h`;
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 24, right: 16, bottom: 4, left: 4 }}>
        <XAxis
          dataKey="time"
          stroke="rgba(255,255,255,0.08)"
          tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.45)', fontFamily: 'ui-monospace, monospace' }}
          tickFormatter={formatTime}
          ticks={xTicks}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={domain}
          stroke="rgba(255,255,255,0.08)"
          tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.45)', fontFamily: 'ui-monospace, monospace' }}
          tickFormatter={formatChartPrice}
          width={58}
          axisLine={false}
          tickLine={false}
          allowDataOverflow
        />

        {/* Between mode: highlight band */}
        {highlightRange && queryMode === 'between' && (
          <>
            <ReferenceArea
              y1={highlightRange[0]}
              y2={highlightRange[1]}
              fill="rgba(255,255,255,0.03)"
              stroke="none"
            />
            <ReferenceLine y={highlightRange[0]} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 3" strokeWidth={1} />
            <ReferenceLine y={highlightRange[1]} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 3" strokeWidth={1} />
          </>
        )}

        {/* Stacked percentile bands */}
        <Area stackId="bands" type="monotone" dataKey="base" fill="transparent" stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b4l" fill={`rgba(${BAND}, 0.15)`} stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b3l" fill={`rgba(${BAND}, 0.25)`} stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b2l" fill={`rgba(${BAND}, 0.35)`} stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b1l" fill={`rgba(${BAND}, 0.50)`} stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b1h" fill={`rgba(${BAND}, 0.50)`} stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b2h" fill={`rgba(${BAND}, 0.35)`} stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b3h" fill={`rgba(${BAND}, 0.25)`} stroke="none" isAnimationActive={false} />
        <Area stackId="bands" type="monotone" dataKey="b4h" fill={`rgba(${BAND}, 0.15)`} stroke="none" isAnimationActive={false} />

        {/* Median line */}
        <Line type="monotone" dataKey="median" stroke="rgba(56, 189, 248, 0.8)" strokeWidth={2} dot={false} isAnimationActive={false} />

        {/* Explorer: target line */}
        {targetLine != null && (
          <ReferenceLine y={targetLine} stroke="rgba(255,255,255,0.85)" strokeDasharray="6 3" strokeWidth={1.5} />
        )}

        {/* Scanner: liquidation / TP / SL */}
        {liquidationPrice != null && (
          <ReferenceLine y={liquidationPrice} stroke="#f43f5e" strokeDasharray="6 3" strokeWidth={1} />
        )}
        {takeProfit != null && (
          <ReferenceLine y={takeProfit} stroke="#10b981" strokeDasharray="6 3" strokeWidth={1} />
        )}
        {stopLoss != null && (
          <ReferenceLine y={stopLoss} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1} />
        )}

        {/* Current price dot at time=0 */}
        <ReferenceDot x={0} y={currentPrice} r={3} fill="#38bdf8" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
