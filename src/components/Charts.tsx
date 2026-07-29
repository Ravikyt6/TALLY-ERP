import { useMemo, useState } from 'react';

export interface TrendPoint {
  label: string;
  total_sale: number;
  total_profit: number;
  invoice_count: number;
}

const W = 720;
const H = 260;
const PAD = { top: 20, right: 16, bottom: 32, left: 56 };

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { salePath, profitPath, maxY, ticks, innerW, innerH, xStep, points } = useMemo(() => {
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const rawMax = Math.max(...data.map(d => Math.max(d.total_sale, d.total_profit)), 1);
    const maxY = niceMax(rawMax);
    const ticks = 4;
    const xStep = data.length > 1 ? innerW / (data.length - 1) : innerW;

    const pts = data.map((d, i) => ({
      x: PAD.left + i * xStep,
      ySale: PAD.top + innerH - (d.total_sale / maxY) * innerH,
      yProfit: PAD.top + innerH - (d.total_profit / maxY) * innerH,
      d,
    }));

    const salePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.ySale.toFixed(1)}`).join(' ');
    const profitPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.yProfit.toFixed(1)}`).join(' ');

    return { salePath, profitPath, maxY, ticks, innerW, innerH, xStep, points: pts };
  }, [data]);

  if (data.length === 0) return null;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="saleFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-500, #2563eb)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand-500, #2563eb)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>

        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = PAD.top + (innerH / ticks) * i;
          const val = maxY - (maxY / ticks) * i;
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--border, #e5e7eb)" strokeWidth="1" strokeDasharray="3 4" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--muted, #6b7280)">{compactNum(val)}</text>
            </g>
          );
        })}

        <polygon
          points={`${points[0].x},${PAD.top + innerH} ${salePath.replace(/M|L/g, '').trim().split(' ').join(' ')} ${points[points.length - 1].x},${PAD.top + innerH}`}
          fill="url(#saleFill)"
        />

        <path d={salePath} fill="none" stroke="var(--brand-500, #2563eb)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={'s' + i} cx={p.x} cy={p.ySale} r={hover === i ? 5 : 3} fill="var(--brand-500, #2563eb)" stroke="var(--surface, #fff)" strokeWidth="1.5" />
        ))}

        <path d={profitPath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 4" />
        {points.map((p, i) => (
          <circle key={'p' + i} cx={p.x} cy={p.yProfit} r={hover === i ? 5 : 3} fill="#10b981" stroke="var(--surface, #fff)" strokeWidth="1.5" />
        ))}

        {points.map((p, i) => {
          const showLabel = data.length <= 12 || i % 2 === 0;
          return (
            <text key={'l' + i} x={p.x} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--muted, #6b7280)" opacity={showLabel ? 1 : 0.5}>
              {p.d.label}
            </text>
          );
        })}

        {points.map((p, i) => (
          <rect key={'h' + i} x={p.x - xStep / 2} y={PAD.top} width={xStep} height={innerH} fill="transparent"
            onMouseEnter={() => setHover(i)} />
        ))}

        {hover !== null && points[hover] && (
          <line x1={points[hover].x} y1={PAD.top} x2={points[hover].x} y2={PAD.top + innerH} stroke="var(--border, #d1d5db)" strokeWidth="1" strokeDasharray="3 3" />
        )}
      </svg>

      {hover !== null && points[hover] && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-app bg-[var(--surface,#fff)] px-3 py-2 text-xs shadow-lg dark:bg-[var(--surface-2,#1f2937)]"
          style={{ left: `${(points[hover].x / W) * 100}%`, top: 4, transform: 'translateX(-50%)' }}
        >
          <p className="mb-1 font-semibold text-app">{points[hover].d.label}</p>
          <p className="flex items-center gap-1.5 text-muted"><span className="inline-block h-2 w-2 rounded-full bg-brand-500" /> Sale: <span className="font-medium text-app">{compactNum(points[hover].d.total_sale)}</span></p>
          <p className="flex items-center gap-1.5 text-muted"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Profit: <span className="font-medium text-app">{compactNum(points[hover].d.total_profit)}</span></p>
          <p className="mt-0.5 text-muted">Invoices: {points[hover].d.invoice_count}</p>
        </div>
      )}

      <div className="mt-2 flex items-center justify-center gap-5 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-full bg-brand-500" /> Total Sale</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-full bg-emerald-500" /> Profit</span>
      </div>
    </div>
  );
}

export interface BarPoint {
  label: string;
  value: number;
  tone: 'sale' | 'profit';
}

export function MiniBarChart({ data, tone = 'sale' }: { data: BarPoint[]; tone?: 'sale' | 'profit' }) {
  const max = Math.max(...data.map(d => Math.abs(d.value)), 1);
  const color = tone === 'profit' ? '#10b981' : 'var(--brand-500, #2563eb)';
  return (
    <div className="flex h-40 items-end justify-between gap-1.5">
      {data.map((d, i) => (
        <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1">
          <div className="relative w-full" style={{ height: '100%' }}>
            <div
              className="absolute bottom-0 w-full rounded-t-md transition-all duration-300 group-hover:opacity-80"
              style={{ height: `${(Math.abs(d.value) / max) * 100}%`, background: color, minHeight: 2 }}
            />
          </div>
          <span className="truncate text-[10px] text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  let nice;
  if (n <= 1) nice = 1; else if (n <= 2) nice = 2; else if (n <= 5) nice = 5; else nice = 10;
  return nice * pow;
}

function compactNum(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + 'Cr';
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + 'L';
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toString();
}
