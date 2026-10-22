'use client'

import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesPoint } from '@domain/reports'
import type { VelocityRow } from '@domain/reports'
import { formatDate } from '@/lib/format'

interface SeriesDef {
  key: string
  label: string
  color: string
  dashed?: boolean
}

const BURNDOWN: SeriesDef[] = [
  { key: 'remaining', label: 'Remaining', color: 'var(--chart-1)' },
  { key: 'ideal', label: 'Ideal', color: 'var(--chart-ref)', dashed: true },
]

const BURNUP: SeriesDef[] = [
  { key: 'completed', label: 'Completed', color: 'var(--chart-1)' },
  { key: 'scope', label: 'Scope', color: 'var(--chart-2)' },
]

// Legend text stays in text ink; the swatch beside it carries the series colour.
const legendText = (value: string) => <span style={{ color: 'var(--text-muted)' }}>{value}</span>

const axis = { stroke: 'var(--border-strong)', tick: { fill: 'var(--text-subtle)', fontSize: 11 }, tickLine: false }

interface TipProps {
  active?: boolean
  label?: string | number
  payload?: { dataKey?: string | number; value?: number | null; color?: string; name?: string }[]
}

function Tip({ active, label, payload, labelFormat }: TipProps & { labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div>{labelFormat ? labelFormat(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="chart-tip-row">
          <i style={{ background: p.color }} />
          <strong>{p.value ?? '-'}</strong> {p.name}
        </div>
      ))}
    </div>
  )
}

function TableToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} aria-expanded={open}>
      {open ? 'Hide table' : 'Show table'}
    </button>
  )
}

/** Burndown (remaining vs ideal) or burnup (completed vs scope) from rebuilt history. */
export function SprintChart({ points, mode }: { points: SeriesPoint[]; mode: 'burndown' | 'burnup' }) {
  const [table, setTable] = useState(false)
  const series = mode === 'burndown' ? BURNDOWN : BURNUP
  const short = (d: string) => formatDate(d, { month: 'short', day: 'numeric' })
  return (
    <div>
      <div className="chart" role="img" aria-label={`${mode === 'burndown' ? 'Burndown' : 'Burnup'} chart in story points by day`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={short} {...axis} minTickGap={16} />
            <YAxis allowDecimals={false} {...axis} axisLine={false} />
            <Tooltip content={<Tip labelFormat={short} />} cursor={{ stroke: 'var(--border-strong)' }} />
            <Legend iconType="plainline" formatter={legendText} wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                // A marker per day keeps day one visible, when a line has a single point.
                dot={s.dashed ? false : { r: 3, strokeWidth: 0, fill: s.color }}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="row-between">
        <span className="xsmall subtle">Story points at the end of each day. Future days stay empty.</span>
        <TableToggle open={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        <div className="table-scroll">
          <table className="chart-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Remaining</th>
                <th>Ideal</th>
                <th>Completed</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <td>{short(p.date)}</td>
                  <td>{p.remaining ?? '-'}</td>
                  <td>{p.ideal}</td>
                  <td>{p.completed ?? '-'}</td>
                  <td>{p.scope ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

/** Committed vs completed points per completed sprint, oldest first. */
export function VelocityChart({ rows, average }: { rows: VelocityRow[]; average: number | null }) {
  const [table, setTable] = useState(false)
  return (
    <div>
      <div className="chart" role="img" aria-label="Velocity chart: committed and completed story points per sprint">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="name" {...axis} interval={0} />
            <YAxis allowDecimals={false} {...axis} axisLine={false} />
            <Tooltip content={<Tip />} cursor={{ fill: 'var(--surface-hover)' }} />
            <Legend iconType="rect" formatter={legendText} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="committed" name="Committed" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
            <Bar dataKey="completed" name="Completed" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="row-between">
        <span className="xsmall subtle">{average !== null ? `Average of the last ${Math.min(3, rows.length)}: ${average} points` : 'No average yet'}</span>
        <TableToggle open={table} onToggle={() => setTable((v) => !v)} />
      </div>
      {table ? (
        <div className="table-scroll">
          <table className="chart-table">
            <thead>
              <tr>
                <th>Sprint</th>
                <th>Committed</th>
                <th>Completed</th>
                <th>Added</th>
                <th>Removed</th>
                <th>Carried over</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.committed}</td>
                  <td>{r.completed}</td>
                  <td>{r.added}</td>
                  <td>{r.removed}</td>
                  <td>{r.carriedOver}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
