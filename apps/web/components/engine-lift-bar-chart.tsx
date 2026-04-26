'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface EngineLiftRow {
  engine: string;
  lift_pp: number;
  ci_low: number;
  ci_high: number;
  significant: boolean;
}

/**
 * Final result chart with confidence intervals. Bars are colored by
 * significance: green for significant positive, red for significant negative,
 * grey otherwise.
 */
export function EngineLiftBarChart({ rows }: { rows: EngineLiftRow[] }) {
  const data = rows.map((r) => ({
    ...r,
    err: [r.lift_pp - r.ci_low, r.ci_high - r.lift_pp],
  }));
  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="engine" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            label={{ value: 'pp', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            formatter={(v: number) => `${v.toFixed(2)}pp`}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Bar dataKey="lift_pp">
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={
                  d.significant && d.lift_pp >= 0
                    ? 'oklch(55% 0.16 145)'
                    : d.significant && d.lift_pp < 0
                      ? 'oklch(58% 0.18 25)'
                      : 'oklch(70% 0.02 270)'
                }
              />
            ))}
            <ErrorBar dataKey="err" stroke="oklch(35% 0.02 270)" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
