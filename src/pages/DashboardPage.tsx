import { useEffect, useState, useMemo } from 'react';
import { LayoutDashboard, ShoppingBag, TrendingUp, Users, FileText, RotateCcw, AlertCircle, Calendar, User, ChevronLeft, ChevronRight, Trophy, Repeat } from 'lucide-react';
import { Card, PageHeader, Spinner, StatCard, EmptyState, Badge } from '../components/ui';
import { VoucherDrawer } from '../components/VoucherDrawer';
import { supabase } from '../lib/supabase';
import { fetchDashboardStats, fetchMonthlySalesPersonStats, fetchTopPartiesBySale, fetchTopPartiesByPurchaseFrequencyLast3Months, fetchMonthlyTrend, type DashboardStats, type MonthlySalesPersonStat, type TopPartyBySale, type TopPartyPurchaseFrequency } from '../lib/queries';
import { fmtINR } from '../lib/format';
import { TrendChart, type TrendPoint } from '../components/Charts';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [drawer, setDrawer] = useState<{ type: string; id: string } | null>(null);

  const now = new Date();
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth());
  const [monthStats, setMonthStats] = useState<MonthlySalesPersonStat[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);

  const [topParties, setTopParties] = useState<TopPartyBySale[]>([]);
  const [topFreq, setTopFreq] = useState<TopPartyPurchaseFrequency[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [s, tp, tf, tr] = await Promise.all([
          fetchDashboardStats(),
          fetchTopPartiesBySale(10),
          fetchTopPartiesByPurchaseFrequencyLast3Months(10),
          fetchMonthlyTrend(12),
        ]);
        setStats(s);
        setTopParties(tp);
        setTopFreq(tf);
        setTrend(tr);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    setMonthLoading(true);
    fetchMonthlySalesPersonStats(selYear, selMonth + 1).then(setMonthStats).catch(() => setMonthStats([])).finally(() => setMonthLoading(false));
  }, [selYear, selMonth]);

  const monthTotals = useMemo(() => ({
    invoices: monthStats.reduce((s, r) => s + r.invoice_count, 0),
    sale: monthStats.reduce((s, r) => s + r.total_sale, 0),
    returned: monthStats.reduce((s, r) => s + r.total_returned, 0),
    expense: monthStats.reduce((s, r) => s + r.total_expense, 0),
    cost: monthStats.reduce((s, r) => s + r.total_cost, 0),
    profit: monthStats.reduce((s, r) => s + r.profit, 0),
  }), [monthStats]);

  const goPrevMonth = () => { if (selMonth === 0) { setSelMonth(11); setSelYear(y => y - 1); } else setSelMonth(m => m - 1); };
  const goNextMonth = () => { if (selMonth === 11) { setSelMonth(0); setSelYear(y => y + 1); } else setSelMonth(m => m + 1); };

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;
  if (err) return <EmptyState title="Error" description={err} icon={<AlertCircle size={28} />} />;
  if (!stats) return null;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Overview of your business" icon={<LayoutDashboard size={20} />} />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Today's Sale" value={fmtINR(stats.todaySale)} tone="brand" icon={<ShoppingBag size={18} />} />
        <StatCard label="This Month" value={fmtINR(stats.monthSale)} tone="success" icon={<TrendingUp size={18} />} />
        <StatCard label="Total Returned" value={fmtINR(stats.totalReturned)} tone="danger" icon={<RotateCcw size={18} />} />
        <StatCard label="Net Revenue" value={fmtINR(stats.netRevenue)} tone="brand" icon={<FileText size={18} />} />
        <StatCard label="Total Profit" value={fmtINR(stats.totalProfit)} tone={stats.totalProfit >= 0 ? 'success' : 'danger'} icon={<TrendingUp size={18} />} />
        <StatCard label="Total Parties" value={String(stats.totalParties)} tone="ink" icon={<Users size={18} />} />
        <StatCard label="Total Invoices" value={String(stats.totalInvoices)} tone="ink" icon={<FileText size={18} />} />
      </div>

      <Card className="mb-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div className="flex items-center gap-2"><TrendingUp size={18} className="text-brand-600" /><h2 className="text-base font-semibold text-app">Sales & Profit Trend — Last 12 Months</h2></div>
        </div>
        <div className="px-3 py-4">
          {trend.length === 0 ? (
            <EmptyState title="No data yet" description="Import sales to see the trend." icon={<TrendingUp size={28} />} />
          ) : (
            <TrendChart data={trend} />
          )}
        </div>
      </Card>

      <Card className="mb-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div className="flex items-center gap-2"><Calendar size={18} className="text-brand-600" /><h2 className="text-base font-semibold text-app">Monthly Sales Person Performance</h2></div>
          <div className="flex items-center gap-2">
            <button onClick={goPrevMonth} className="btn-ghost p-1.5"><ChevronLeft size={18} /></button>
            <span className="min-w-[140px] text-center text-sm font-medium text-app">{MONTH_NAMES[selMonth]} {selYear}</span>
            <button onClick={goNextMonth} className="btn-ghost p-1.5"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-b border-app px-5 py-3 lg:grid-cols-6">
          <MiniStat label="Invoices" value={String(monthTotals.invoices)} />
          <MiniStat label="Total Sale" value={fmtINR(monthTotals.sale)} />
          <MiniStat label="Returned" value={fmtINR(monthTotals.returned)} tone="rose" />
          <MiniStat label="Cost" value={fmtINR(monthTotals.cost)} tone="amber" />
          <MiniStat label="Expense" value={fmtINR(monthTotals.expense)} tone="amber" />
          <MiniStat label="Profit" value={fmtINR(monthTotals.profit)} tone={monthTotals.profit >= 0 ? 'emerald' : 'rose'} />
        </div>
        {monthLoading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : monthStats.length === 0 ? (
          <EmptyState title="No data for this month" description="No sales recorded in the selected month." icon={<Calendar size={28} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="surface text-xs text-muted">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Sales Person</th>
                  <th className="px-5 py-2.5 text-right font-medium">Invoices</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total Sale</th>
                  <th className="px-5 py-2.5 text-right font-medium">Returned</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-5 py-2.5 text-right font-medium">Expense</th>
                  <th className="px-5 py-2.5 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody>
                {monthStats.map(r => (
                  <tr key={r.sales_person} className="border-t border-app transition hover:bg-[var(--surface-2)]">
                    <td className="px-5 py-2.5"><div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/30"><User size={14} /></div><span className="font-medium text-app">{r.sales_person}</span></div></td>
                    <td className="px-5 py-2.5 text-right text-muted">{r.invoice_count}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-app whitespace-nowrap">{fmtINR(r.total_sale)}</td>
                    <td className="px-5 py-2.5 text-right text-rose-600 whitespace-nowrap">{r.total_returned > 0 ? fmtINR(r.total_returned) : '—'}</td>
                    <td className="px-5 py-2.5 text-right text-amber-600 whitespace-nowrap">{r.total_cost > 0 ? fmtINR(r.total_cost) : '—'}</td>
                    <td className="px-5 py-2.5 text-right text-amber-600 whitespace-nowrap">{r.total_expense > 0 ? fmtINR(r.total_expense) : '—'}</td>
                    <td className={`px-5 py-2.5 text-right font-bold whitespace-nowrap ${r.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtINR(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top 10 parties by sale (all-time till today) */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-app px-5 py-4">
            <Trophy size={18} className="text-amber-500" />
            <h2 className="text-base font-semibold text-app">Top 10 Parties by Sale</h2>
          </div>
          {topParties.length === 0 ? (
            <EmptyState title="No sales yet" description="Import data to see top parties." icon={<Trophy size={28} />} />
          ) : (
            <div className="overflow-hidden">
              <table className="w-full table-fixed text-sm">
                <thead className="surface text-xs text-muted">
                  <tr>
                    <th className="w-10 px-5 py-2.5 text-left font-medium">#</th>
                    <th className="px-5 py-2.5 text-left font-medium">Party</th>
                    <th className="w-20 px-5 py-2.5 text-right font-medium">Invoices</th>
                    <th className="w-28 px-5 py-2.5 text-right font-medium">Total Sale</th>
                    <th className="w-28 px-5 py-2.5 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {topParties.map((p, i) => (
                    <tr key={p.party_id} className="border-t border-app transition hover:bg-[var(--surface-2)]">
                      <td className="px-5 py-2.5 text-muted">{i + 1}</td>
                      <td className="truncate px-5 py-2.5 font-medium text-app">{p.party_name}</td>
                      <td className="px-5 py-2.5 text-right text-muted">{p.invoice_count}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-app whitespace-nowrap">{fmtINR(p.total_sale)}</td>
                      <td className={`px-5 py-2.5 text-right font-medium whitespace-nowrap ${p.total_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtINR(p.total_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Top parties by purchase frequency in last 3 months */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-app px-5 py-4">
            <Repeat size={18} className="text-brand-600" />
            <h2 className="text-base font-semibold text-app">Top Parties — Last 3 Months</h2>
          </div>
          {topFreq.length === 0 ? (
            <EmptyState title="No recent purchases" description="No sales in the last 3 months." icon={<Repeat size={28} />} />
          ) : (
            <div className="overflow-hidden">
              <table className="w-full table-fixed text-sm">
                <thead className="surface text-xs text-muted">
                  <tr>
                    <th className="w-10 px-5 py-2.5 text-left font-medium">#</th>
                    <th className="px-5 py-2.5 text-left font-medium">Party</th>
                    <th className="w-20 px-5 py-2.5 text-right font-medium">Purchases</th>
                    <th className="w-28 px-5 py-2.5 text-right font-medium">Amount</th>
                    <th className="w-28 px-5 py-2.5 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {topFreq.map((p, i) => (
                    <tr key={p.party_id} className="border-t border-app transition hover:bg-[var(--surface-2)]">
                      <td className="px-5 py-2.5 text-muted">{i + 1}</td>
                      <td className="truncate px-5 py-2.5 font-medium text-app">{p.party_name}</td>
                      <td className="px-5 py-2.5 text-right"><Badge tone="brand">{p.purchase_count}</Badge></td>
                      <td className="px-5 py-2.5 text-right font-medium text-app whitespace-nowrap">{fmtINR(p.total_amount)}</td>
                      <td className={`px-5 py-2.5 text-right font-medium whitespace-nowrap ${p.total_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtINR(p.total_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <VoucherDrawer voucherType={drawer?.type ?? null} voucherId={drawer?.id ?? null} onClose={() => setDrawer(null)} />
    </div>
  );
}

function MiniStat({ label, value, tone = 'ink' }: { label: string; value: string; tone?: string }) {
  const tones: Record<string, string> = { ink: 'text-app', emerald: 'text-emerald-600', rose: 'text-rose-600', amber: 'text-amber-600', brand: 'text-brand-600' };
  return <div className="text-center"><p className="text-xs text-muted">{label}</p><p className={`mt-0.5 text-sm font-bold ${tones[tone] ?? tones.ink}`}>{value}</p></div>;
}
