'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface SparkPoint {
  t: string; // ISO date
  v: number; // visibility 0-1
}

/**
 * Tiny per-engine sparkline used in the dashboard list. Recharts is the
 * §11 default; we keep the wrapper simple so swapping libraries later is
 * one file.
 */
export function LiftSparkline({
  data,
  height = 60,
}: {
  data: SparkPoint[];
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div
        className="text-xs text-[color:var(--color-muted)] italic"
        style={{ height }}
      >
        no data yet
      </div>
    );
  }
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke="oklch(58% 0.18 250)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <XAxis dataKey="t" hide />
          <YAxis domain={[0, 1]} hide />
          <Tooltip
            formatter={(v: number) => `${(v * 100).toFixed(1)}%`}
            labelFormatter={(t: string) => new Date(t).toLocaleDateString()}
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid oklch(92% 0.005 270)',
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
