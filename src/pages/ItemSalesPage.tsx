import { useEffect, useMemo, useState } from 'react';
import { Package, Search, TrendingUp, Calendar, BarChart3, ChevronRight, Users, ShoppingBag, IndianRupee } from 'lucide-react';
import { Card, PageHeader, Spinner, EmptyState, Badge } from '../components/ui';
import { fmtINR } from '../lib/format';
import { fetchItemSales, fetchAllSkusWithMappings, fetchItemPartyBreakdown, type ItemSaleRow, type ItemSaleMode, type ItemPartyBreakdown, type SkuMapping } from '../lib/queries';

function bucketDateRange(key: string, mode: ItemSaleMode): { from: string; to: string } {
  if (mode === 'weekly') {
    const start = new Date(key);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: key, to: end.toISOString().slice(0, 10) };
  }
  const [y, m] = key.split('-').map(Number);
  const from = `${key}-01`;
  const end = new Date(y, m, 0);
  return { from, to: end.toISOString().slice(0, 10) };
}

export default function ItemSalesPage() {
  const [mode, setMode] = useState<ItemSaleMode>('weekly');
  const [monthsBack, setMonthsBack] = useState(3);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ItemSaleRow[]>([]);
  const [skus, setSkus] = useState<SkuMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [parties, setParties] = useState<ItemPartyBreakdown[]>([]);
  const [partyLoading, setPartyLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [rows, skuMappings] = await Promise.all([
          fetchItemSales(mode, monthsBack, search),
          fetchAllSkusWithMappings(),
        ]);
        setData(rows);
        setSkus(skuMappings);
        setExpandedBucket(null);
        if (rows.length > 0 && !selectedItem) setSelectedItem(rows[0].item_name);
        else if (rows.length > 0 && !rows.find(r => r.item_name === selectedItem)) {
          setSelectedItem(rows[0].item_name);
        }
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
      finally { setLoading(false); }
    })();
  }, [mode, monthsBack, search]);

  useEffect(() => {
    if (!selectedItem || !expandedBucket) { setParties([]); return; }
    (async () => {
      setPartyLoading(true);
      try {
        const range = bucketDateRange(expandedBucket, mode);
        const p = await fetchItemPartyBreakdown(selectedItem, monthsBack, range);
        setParties(p);
      } catch { setParties([]); }
      finally { setPartyLoading(false); }
    })();
  }, [selectedItem, expandedBucket, mode, monthsBack]);

  const selectedRow = useMemo(
    () => data.find(r => r.item_name === selectedItem) ?? null,
    [data, selectedItem]
  );

  const groupedSkus = useMemo(() => {
    const seen = new Set<string>();
    const result: SkuMapping[] = [];
    for (const s of skus) {
      if (!s.groupName) continue;
      if (seen.has(s.skuName)) continue;
      seen.add(s.skuName);
      result.push(s);
    }
    return result;
  }, [skus]);

  const allLabels = useMemo(() => {
    if (!selectedRow) return [];
    return selectedRow.buckets.map(b => b.label);
  }, [selectedRow]);

  return (
    <div>
      <PageHeader
        title="Item Sales Tracker"
        subtitle="Track item-wise sales weekly or monthly"
        icon={<Package size={20} />}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-app bg-[var(--surface)] p-0.5">
              <button
                onClick={() => setMode('weekly')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === 'weekly' ? 'bg-brand-600 text-white' : 'text-muted hover:text-app'}`}
              >
                <Calendar size={14} /> Weekly
              </button>
              <button
                onClick={() => setMode('monthly')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${mode === 'monthly' ? 'bg-brand-600 text-white' : 'text-muted hover:text-app'}`}
              >
                <BarChart3 size={14} /> Monthly
              </button>
            </div>
            <select
              value={monthsBack}
              onChange={e => setMonthsBack(Number(e.target.value))}
              className="rounded-lg border border-app bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-app"
            >
              <option value={1}>Last 1 month</option>
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
            </select>
          </div>
        }
      />

      {err && <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}

      <Card className="mb-6 p-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items by name..."
            className="w-full rounded-lg border border-app bg-[var(--surface-2)] py-2.5 pl-10 pr-4 text-sm text-app placeholder:text-muted focus:border-brand-500 focus:outline-none"
          />
        </div>
        {search && skus.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skus.filter(s => s.skuName.toLowerCase().includes(search.toLowerCase())).slice(0, 8).map(s => (
              <button key={s.skuName} onClick={() => setSearch(s.skuName)} className="rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300">
                {s.skuName}{s.groupName ? ` · ${s.groupName}` : ''}
              </button>
            ))}
          </div>
        )}
      </Card>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data.length === 0 ? (
        <Card><EmptyState title="No item sales found" description="Try adjusting filters or import sales data first." icon={<Package size={28} />} /></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          <Card className="lg:col-span-2 overflow-hidden lg:sticky lg:top-4">
            <div className="border-b border-app px-4 py-3">
              <h3 className="text-sm font-semibold text-app">All Items ({groupedSkus.length})</h3>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Item</th>
                    <th className="px-4 py-2 text-left font-medium">Group</th>
                    <th className="w-20 px-4 py-2 text-right font-medium">Qty</th>
                    <th className="w-28 px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedSkus.map((sku) => {
                    const row = data.find(r => r.item_name === sku.skuName);
                    return (
                      <tr
                        key={sku.skuName}
                        onClick={() => { setSelectedItem(sku.skuName); setExpandedBucket(null); }}
                        className={`cursor-pointer border-t border-app transition ${selectedItem === sku.skuName ? 'bg-brand-100 dark:bg-brand-900/30 ring-1 ring-inset ring-brand-300 dark:ring-brand-700' : 'hover:bg-[var(--surface-2)]'}`}
                      >
                        <td className="truncate px-4 py-2.5 font-medium text-app" title={sku.skuName}>{sku.skuName}</td>
                        <td className="truncate px-4 py-2.5">{sku.groupName ? <Badge tone="brand">{sku.groupName}</Badge> : <span className="text-xs text-muted">—</span>}</td>
                        <td className="px-4 py-2.5 text-right text-muted">{row?.total_quantity ?? 0}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-app whitespace-nowrap">{row ? fmtINR(row.total_amount) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="lg:col-span-3 overflow-hidden">
            {selectedRow ? (
              <>
                <div className="border-b border-app px-5 py-4">
                  <h3 className="text-base font-semibold text-app">{selectedRow.item_name}</h3>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <Badge tone="brand">Total Qty: {selectedRow.total_quantity}</Badge>
                    <Badge tone="success">Total Sale: {fmtINR(selectedRow.total_amount)}</Badge>
                    <Badge tone="ink">{mode === 'weekly' ? 'Weekly' : 'Monthly'} view</Badge>
                  </div>
                </div>

                <div className="px-4 py-4">
                  <ItemBarChart labels={allLabels} quantities={selectedRow.buckets.map(b => b.quantity)} amounts={selectedRow.buckets.map(b => b.amount)} />
                </div>

                <div className="border-t border-app px-4 py-3">
                  <h4 className="text-sm font-semibold text-app">{mode === 'weekly' ? 'Week Starting' : 'Month'} — click to see parties</h4>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--surface)] text-xs text-muted">
                      <tr>
                        <th className="w-8 px-2 py-2"></th>
                        <th className="px-4 py-2 text-left font-medium">{mode === 'weekly' ? 'Week Starting' : 'Month'}</th>
                        <th className="px-4 py-2 text-right font-medium">Qty</th>
                        <th className="px-4 py-2 text-right font-medium">Amount</th>
                        <th className="px-4 py-2 text-right font-medium">Invoices</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRow.buckets.map((b, i) => {
                        const isOpen = expandedBucket === b.key;
                        const hasData = b.invoice_count > 0;
                        return (
                          <>
                            <tr
                              key={i}
                              onClick={() => hasData && setExpandedBucket(isOpen ? null : b.key)}
                              className={`border-t border-app transition ${hasData ? 'cursor-pointer hover:bg-[var(--surface-2)]' : 'opacity-50'} ${isOpen ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}
                            >
                              <td className="px-2 py-2.5 text-muted">
                                {hasData && <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-app">{b.label}</td>
                              <td className="px-4 py-2.5 text-right text-muted">{b.quantity}</td>
                              <td className="px-4 py-2.5 text-right font-medium text-app whitespace-nowrap">{fmtINR(b.amount)}</td>
                              <td className="px-4 py-2.5 text-right text-muted">{b.invoice_count}</td>
                            </tr>
                            {isOpen && (
                              <tr key={`${i}-exp`} className="border-t border-app bg-[var(--surface-2)]">
                                <td></td>
                                <td colSpan={4} className="px-4 py-3">
                                  {partyLoading ? (
                                    <div className="flex justify-center py-6"><Spinner size={20} /></div>
                                  ) : parties.length === 0 ? (
                                    <div className="py-4 text-center text-sm text-muted">No party data for this period.</div>
                                  ) : (
                                    <div>
                                      <div className="mb-3 grid grid-cols-3 gap-3">
                                        <div className="rounded-lg border border-app bg-[var(--surface)] p-2.5">
                                          <div className="flex items-center gap-1.5 text-xs text-muted"><Users size={12} /> Parties</div>
                                          <p className="mt-0.5 text-base font-bold text-app">{parties.length}</p>
                                        </div>
                                        <div className="rounded-lg border border-app bg-[var(--surface)] p-2.5">
                                          <div className="flex items-center gap-1.5 text-xs text-muted"><ShoppingBag size={12} /> Invoices</div>
                                          <p className="mt-0.5 text-base font-bold text-app">{parties.reduce((s, p) => s + p.invoice_count, 0)}</p>
                                        </div>
                                        <div className="rounded-lg border border-app bg-[var(--surface)] p-2.5">
                                          <div className="flex items-center gap-1.5 text-xs text-muted"><IndianRupee size={12} /> Top Party</div>
                                          <p className="mt-0.5 text-base font-bold text-app">{parties.length > 0 ? fmtINR(parties[0].total_amount) : '—'}</p>
                                        </div>
                                      </div>
                                      <table className="w-full text-sm">
                                        <thead className="text-xs text-muted">
                                          <tr>
                                            <th className="py-1.5 text-left font-medium">Party</th>
                                            <th className="py-1.5 text-right font-medium">Qty</th>
                                            <th className="py-1.5 text-right font-medium">Amount</th>
                                            <th className="py-1.5 text-right font-medium">Inv</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {parties.map((p) => (
                                            <tr key={p.party_id} className="border-t border-app">
                                              <td className="truncate py-2 pr-2 font-medium text-app" title={p.party_name}>{p.party_name}</td>
                                              <td className="py-2 text-right text-muted">{p.total_quantity}</td>
                                              <td className="py-2 text-right font-medium text-app whitespace-nowrap">{fmtINR(p.total_amount)}</td>
                                              <td className="py-2 text-right text-muted">{p.invoice_count}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState title="Select an item" description="Click an item from the list to see its sales breakdown." icon={<TrendingUp size={28} />} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function ItemBarChart({ labels, quantities, amounts }: { labels: string[]; quantities: number[]; amounts: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const maxQty = Math.max(...quantities, 1);

  if (labels.length === 0) return null;

  return (
    <div>
      <div className="flex h-44 items-end justify-between gap-1.5">
        {labels.map((label, i) => (
          <div key={i} className="group relative flex flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="relative w-full" style={{ height: '100%' }}>
              <div
                className="absolute bottom-0 w-full rounded-t-md transition-all duration-300"
                style={{
                  height: `${(quantities[i] / maxQty) * 100}%`,
                  background: hover === i ? 'var(--brand-600, #2563eb)' : 'var(--brand-500, #3b82f6)',
                  minHeight: 2,
                }}
              />
            </div>
            <span className="truncate text-[10px] text-muted" style={{ maxWidth: 60 }}>{label}</span>

            {hover === i && (
              <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-app bg-[var(--surface)] px-3 py-2 text-xs shadow-lg">
                <p className="font-semibold text-app">{label}</p>
                <p className="text-muted">Qty: <span className="font-medium text-app">{quantities[i]}</span></p>
                <p className="text-muted">Sale: <span className="font-medium text-app">{fmtINR(amounts[i])}</span></p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-full bg-brand-500" /> Quantity Sold</span>
      </div>
    </div>
  );
}
