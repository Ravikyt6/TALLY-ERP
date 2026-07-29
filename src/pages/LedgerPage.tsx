import { useEffect, useState, useMemo } from 'react';
import { BookOpen, AlertCircle, Search, X, ChevronRight } from 'lucide-react';
import { Card, PageHeader, Spinner, EmptyState, Badge } from '../components/ui';
import { VoucherDrawer } from '../components/VoucherDrawer';
import { supabase, type Party } from '../lib/supabase';
import { fetchPartyLedger, type LedgerRow } from '../lib/queries';
import { fmtINR, fmtDate } from '../lib/format';

interface PartyLedgerGroup { party: Party; rows: LedgerRow[]; }

export default function LedgerPage() {
  const [groups, setGroups] = useState<PartyLedgerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ type: string; id: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: parties, error } = await supabase.from('parties').select('*').order('name');
        if (error) throw error;
        const partyList = (parties ?? []) as Party[];
        const results: PartyLedgerGroup[] = [];
        for (const p of partyList) {
          const rows = await fetchPartyLedger(p.id);
          if (rows.length > 0) results.push({ party: p, rows });
        }
        setGroups(results);
        if (results.length > 0) setSelectedId(results[0].party.id);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return groups;
    return groups.filter(g => g.party.name.toLowerCase().includes(q) || (g.party.gstin ?? '').toLowerCase().includes(q));
  }, [groups, search]);

  const selected = useMemo(() => groups.find(g => g.party.id === selectedId) ?? null, [groups, selectedId]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;
  if (err) return <EmptyState title="Error" description={err} icon={<AlertCircle size={28} />} />;

  return (
    <div>
      <PageHeader title="Ledger" subtitle="Party-wise ledger entries" icon={<BookOpen size={20} />} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Left: party list with search */}
        <Card className="flex flex-col overflow-hidden p-0">
          <div className="border-b border-app p-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search parties…" className="input pl-9 text-sm" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-app"><X size={14} /></button>}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted">No parties found</div>
            ) : (
              filtered.map(g => {
                const isActive = g.party.id === selectedId;
                const balance = g.rows.reduce((s, r) => s + r.debit - r.credit, 0);
                return (
                  <button
                    key={g.party.id}
                    onClick={() => setSelectedId(g.party.id)}
                    className={`flex w-full items-center justify-between border-b border-app px-4 py-3 text-left transition ${isActive ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-2)]'}`}
                  >
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${isActive ? 'text-brand-600' : 'text-app'}`}>{g.party.name}</p>
                      <p className="text-xs text-muted">{g.rows.length} entries</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-muted">Bal</p>
                        <p className={`text-xs font-semibold tabular-nums ${balance >= 0 ? 'text-app' : 'text-rose-600'}`}>{fmtINR(balance)}</p>
                      </div>
                      <ChevronRight size={14} className={isActive ? 'text-brand-600' : 'text-muted'} />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right: ledger details */}
        <Card className="overflow-hidden p-0">
          {!selected ? (
            <EmptyState title="No party selected" description="Select a party from the list to view their ledger." icon={<BookOpen size={28} />} />
          ) : (
            <div className="flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-app bg-[var(--surface-2)] px-5 py-3.5">
                <div>
                  <p className="text-base font-semibold text-app">{selected.party.name}</p>
                  <p className="text-xs text-muted">{selected.party.gstin ? `GSTIN: ${selected.party.gstin}` : 'No GSTIN'} · {selected.rows.length} entries</p>
                </div>
                {(() => {
                  const totalDebit = selected.rows.reduce((s, r) => s + r.debit, 0);
                  const totalCredit = selected.rows.reduce((s, r) => s + r.credit, 0);
                  const balance = totalDebit - totalCredit;
                  return (
                    <div className="text-right">
                      <p className="text-xs text-muted">Closing Balance</p>
                      <p className={`text-sm font-bold tabular-nums ${balance >= 0 ? 'text-app' : 'text-rose-600'}`}>{fmtINR(balance)}</p>
                    </div>
                  );
                })()}
              </div>
              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="surface text-xs text-muted">
                    <tr>
                      <th className="px-5 py-2.5 text-left font-medium">Date</th>
                      <th className="px-5 py-2.5 text-left font-medium">Type</th>
                      <th className="px-5 py-2.5 text-left font-medium">Voucher</th>
                      <th className="px-5 py-2.5 text-left font-medium">Particular</th>
                      <th className="px-5 py-2.5 text-right font-medium">Debit</th>
                      <th className="px-5 py-2.5 text-right font-medium">Credit</th>
                      <th className="px-5 py-2.5 text-right font-medium">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rows.map(row => (
                      <tr
                        key={row.id}
                        onClick={() => row.voucher_id && setDrawer({ type: row.voucher_type, id: row.voucher_id })}
                        className={`border-t border-app transition hover:bg-[var(--surface-2)] ${row.voucher_id ? 'cursor-pointer' : ''}`}
                      >
                        <td className="px-5 py-2.5 text-muted whitespace-nowrap">{fmtDate(row.entry_date)}</td>
                        <td className="px-5 py-2.5"><Badge tone={row.voucher_type === 'sale' ? 'brand' : 'ink'}>{row.voucher_type}</Badge></td>
                        <td className="px-5 py-2.5 font-medium text-app">{row.voucher_number ?? '—'}</td>
                        <td className="px-5 py-2.5 text-muted">{row.particular || '—'}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap tabular-nums">{row.debit > 0 ? fmtINR(row.debit) : '—'}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap tabular-nums">{row.credit > 0 ? fmtINR(row.credit) : '—'}</td>
                        <td className={`px-5 py-2.5 text-right whitespace-nowrap tabular-nums ${row.profit > 0 ? 'text-emerald-600' : row.profit < 0 ? 'text-rose-600' : 'text-muted'}`}>{row.profit !== 0 ? fmtINR(row.profit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {(() => {
                      const totalDebit = selected.rows.reduce((s, r) => s + r.debit, 0);
                      const totalCredit = selected.rows.reduce((s, r) => s + r.credit, 0);
                      const totalProfit = selected.rows.reduce((s, r) => s + r.profit, 0);
                      return (
                        <tr className="border-t-2 border-app bg-[var(--surface-2)]">
                          <td colSpan={4} className="px-5 py-3 text-xs font-semibold text-app">Total</td>
                          <td className="px-5 py-3 text-right font-semibold text-app tabular-nums whitespace-nowrap">{fmtINR(totalDebit)}</td>
                          <td className="px-5 py-3 text-right font-semibold text-app tabular-nums whitespace-nowrap">{fmtINR(totalCredit)}</td>
                          <td className={`px-5 py-3 text-right font-semibold tabular-nums whitespace-nowrap ${totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{totalProfit !== 0 ? fmtINR(totalProfit) : '—'}</td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>
      <VoucherDrawer voucherType={drawer?.type ?? null} voucherId={drawer?.id ?? null} onClose={() => setDrawer(null)} />
    </div>
  );
}
