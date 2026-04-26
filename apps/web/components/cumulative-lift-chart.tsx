'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface CumulativePoint {
  t: string; // ISO date
  pp: number; // cumulative pp gained
  label?: string; // optional experiment name attached at this point
}

/**
 * CumulativeLiftChart — YTD pp gained across all WIN experiments. Sits on the
 * dashboard. The Y axis is in percentage points; Y starts at 0.
 *
 * "The dopamine hit; the number marketing leaders screenshot." — PLAN.md §6.4
 */
export function CumulativeLiftChart({
  data,
  height = 200,
}: {
  data: CumulativePoint[];
  height?: number;
}) {
  if (data.length <= 1) {
    return (
      <div
        className="flex items-center justify-center text-xs text-[color:var(--color-muted)] italic"
        style={{ height }}
      >
        No wins logged yet — your first finalised experiment shows up here.
      </div>
    );
  }
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cumulFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(58% 0.18 250)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="oklch(58% 0.18 250)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(92% 0.005 270)" />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 11, fill: 'oklch(58% 0.01 270)' }}
            tickFormatter={(t: string) =>
              new Date(t).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })
            }
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'oklch(58% 0.01 270)' }}
            tickFormatter={(v: number) => `${v.toFixed(0)}pp`}
            domain={[0, 'auto']}
          />
          <Tooltip
            formatter={(v: number) => [`${v.toFixed(2)}pp`, 'Cumulative']}
            labelFormatter={(t: string) =>
              new Date(t).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            }
            contentStyle={{
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid oklch(92% 0.005 270)',
            }}
          />
          <Area
            type="monotone"
            dataKey="pp"
            stroke="oklch(58% 0.18 250)"
            strokeWidth={2}
            fill="url(#cumulFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
