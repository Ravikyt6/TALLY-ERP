import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Printer, FileText, CheckCircle2, Calculator } from 'lucide-react';
import { Card, Badge, EmptyState, Spinner } from '../components/ui';
import { supabase, type Sale, type SaleItem, type Party } from '../lib/supabase';
import { fmtINR, fmtDate } from '../lib/format';
import { exportToPDF, printDocument } from '../lib/exports';

function statusTone(status: string): string {
  switch (status) {
    case 'completed': return 'success';
    case 'partial_return': return 'warning';
    case 'fully_returned': return 'danger';
    default: return 'ink';
  }
}

export default function InvoiceDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [sale, setSale] = useState<Sale | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [party, setParty] = useState<Party | null>(null);
  const [receipts, setReceipts] = useState<{ voucher_number: string; voucher_date: string; amount: number }[]>([]);
  const [creditNotes, setCreditNotes] = useState<{ voucher_number: string; voucher_date: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (id) load(id); }, [id]);

  async function load(lid: string) {
    setLoading(true);
    const { data: ledger } = await supabase.from('ledger_entries').select('voucher_id, voucher_type').eq('id', lid).maybeSingle();
    const saleId = ledger?.voucher_id;
    if (!saleId) { setLoading(false); return; }

    const { data: s } = await supabase.from('sales').select('*').eq('id', saleId).maybeSingle();
    const saleRow = s as Sale | null;
    setSale(saleRow);
    if (saleRow) {
      const { data: it } = await supabase.from('sale_items').select('*').eq('sale_id', saleRow.id);
      setItems((it ?? []) as SaleItem[]);
      const { data: p } = await supabase.from('parties').select('*').eq('id', saleRow.party_id).maybeSingle();
      setParty(p as Party | null);
      const { data: r } = await supabase.from('receipts').select('voucher_number, voucher_date, amount').eq('party_id', saleRow.party_id).order('voucher_date');
      setReceipts((r ?? []) as { voucher_number: string; voucher_date: string; amount: number }[]);
      const { data: c } = await supabase.from('credit_notes').select('voucher_number, voucher_date, amount').eq('party_id', saleRow.party_id).order('voucher_date');
      setCreditNotes((c ?? []) as { voucher_number: string; voucher_date: string; amount: number }[]);
    }
    setLoading(false);
  }

  const paidAmount = receipts.reduce((s, r) => s + Number(r.amount), 0) + creditNotes.reduce((s, c) => s + Number(c.amount), 0);
  const outstanding = (sale?.grand_total ?? 0) - paidAmount;

  const totalCost = items.reduce((s, it) => s + ((it.quantity ?? 0) - (it.returned_qty ?? 0)) * (it.cost_price ?? 0), 0);
  const expenseTotal = (() => {
    const bd = sale?.expense_breakdown as Record<string, number> | null;
    if (bd && Object.keys(bd).length > 0) return Object.values(bd).reduce((s, v) => s + (v || 0), 0);
    return sale?.expense ?? 0;
  })();
  const netProfit = sale?.profit ?? 0;
  const profitMargin = sale?.grand_total ? (netProfit / sale.grand_total) * 100 : 0;

  const pdfHeaders = ['Item', 'Qty', 'Rate', 'Discount', 'Amount'];
  const pdfRows: (string | number)[][] = items.map((it) => [it.name, String(it.quantity), fmtINR(it.rate), it.discount ? fmtINR(it.discount) : '—', fmtINR(it.amount)]);

  const doExportPDF = () => {
    if (!sale) return;
    exportToPDF(`Invoice ${sale.invoice_number}`, pdfHeaders, pdfRows);
  };

  const doPrint = () => {
    if (!sale) return;
    printDocument(`Invoice ${sale.invoice_number}`, pdfHeaders, pdfRows);
  };

  if (loading) return <div className="py-20 grid place-items-center"><Spinner size={28} /></div>;
  if (!sale) return <EmptyState title="Invoice not found" icon={<FileText size={40} />} />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 no-print">
        <button className="btn-ghost p-2" onClick={() => nav(-1)}><ArrowLeft size={18} /></button>
        <div className="flex-1" />
        <button className="btn-secondary" onClick={doExportPDF}><Download size={16} /> PDF</button>
        <button className="btn-secondary" onClick={doPrint}><Printer size={16} /> Print</button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
              <div>
                <p className="text-xs text-muted uppercase tracking-wide">Invoice</p>
                <h2 className="text-2xl font-bold text-app">{sale.invoice_number}</h2>
                <p className="text-sm text-muted mt-1">{fmtDate(sale.invoice_date)}</p>
              </div>
              <Badge tone={statusTone(sale.status)}>{sale.status}</Badge>
            </div>

            {party && (
              <div className="rounded-lg bg-[var(--surface-2)] p-4 mb-6">
                <p className="text-xs text-muted uppercase mb-1">Bill To</p>
                <p className="font-semibold text-app">{party.name}</p>
                <p className="text-sm text-muted">{party.gstin ?? '—'}</p>
                <p className="text-sm text-muted">{party.phone ?? '—'}</p>
              </div>
            )}

            <table className="w-full">
              <thead>
                <tr className="border-b border-app">
                  <th className="text-left text-xs font-medium text-muted py-2">Item</th>
                  <th className="text-right text-xs font-medium text-muted py-2">Qty</th>
                  <th className="text-right text-xs font-medium text-muted py-2">Rate</th>
                  <th className="text-right text-xs font-medium text-muted py-2">Disc</th>
                  <th className="text-right text-xs font-medium text-muted py-2">Amount</th>
                  <th className="text-right text-xs font-medium text-muted py-2">Cost Price</th>
                  <th className="text-right text-xs font-medium text-muted py-2">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2"><p className="font-medium text-app">{it.name}</p>{it.hsn && <p className="text-xs text-muted">HSN: {it.hsn}</p>}</td>
                    <td className="py-2 text-right tabular-nums text-app">{it.quantity}</td>
                    <td className="py-2 text-right tabular-nums text-app">{fmtINR(it.rate)}</td>
                    <td className="py-2 text-right tabular-nums text-app">{it.discount ? fmtINR(it.discount) : '—'}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-app">{fmtINR(it.amount)}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{it.cost_price != null ? fmtINR(it.cost_price) : '—'}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{it.cost_price != null ? fmtINR(((it.quantity ?? 0) - (it.returned_qty ?? 0)) * it.cost_price) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end mt-6">
              <div className="w-full sm:w-72 space-y-2 text-sm">
                <Row label="Subtotal" value={fmtINR(sale.subtotal)} />
                <Row label="Discount" value={sale.discount ? `- ${fmtINR(sale.discount)}` : '—'} />
                <Row label="Tax" value={sale.tax ? fmtINR(sale.tax) : '—'} />
                <Row label="Shipping" value={sale.shipping ? fmtINR(sale.shipping) : '—'} />
                <Row label="Round Off" value={sale.round_off ? fmtINR(sale.round_off) : '—'} />
                <div className="border-t border-app pt-2 flex justify-between font-bold text-base">
                  <span className="text-app">Grand Total</span><span className="text-brand-600">{fmtINR(sale.grand_total)}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h3 className="font-semibold text-sm text-app mb-4">Outstanding</h3>
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-sm text-muted">Invoice Total</span><span className="font-semibold text-app">{fmtINR(sale.grand_total)}</span></div>
              <div className="flex justify-between"><span className="text-sm text-muted">Received / Adjusted</span><span className="font-semibold text-emerald-600">{fmtINR(paidAmount)}</span></div>
              <div className="border-t border-app pt-3 flex justify-between">
                <span className="text-sm font-medium text-app">Outstanding</span>
                <span className={`font-bold ${outstanding > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmtINR(outstanding)}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-sm text-app mb-3 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /> Payment History</h3>
            {receipts.length === 0 ? <p className="text-xs text-muted">No receipts recorded.</p> :
              <div className="space-y-2">{receipts.map((r, i) => (
                <div key={i} className="flex justify-between text-sm"><span className="text-app">{r.voucher_number} · {fmtDate(r.voucher_date)}</span><span className="font-medium text-emerald-600">{fmtINR(r.amount)}</span></div>
              ))}</div>}
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-sm text-app mb-4 flex items-center gap-2"><Calculator size={16} className="text-brand-600" /> Costing</h3>
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-sm text-muted">Total Cost</span><span className="font-semibold text-app tabular-nums">{fmtINR(totalCost)}</span></div>
              <div className="flex justify-between"><span className="text-sm text-muted">Expenses</span><span className="font-semibold text-app tabular-nums">{fmtINR(expenseTotal)}</span></div>
              <div className="flex justify-between"><span className="text-sm text-muted">Grand Total</span><span className="font-semibold text-app tabular-nums">{fmtINR(sale?.grand_total ?? 0)}</span></div>
              <div className="border-t border-app pt-3 flex justify-between">
                <span className="text-sm font-medium text-app">Net Profit (after expense)</span>
                <span className={`font-bold tabular-nums ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtINR(netProfit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted">Margin</span>
                <span className={`font-medium tabular-nums ${profitMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{profitMargin.toFixed(1)}%</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-sm text-app mb-3">Linked Credit Notes</h3>
            {creditNotes.length === 0 ? <p className="text-xs text-muted">No credit notes linked.</p> :
              <div className="space-y-2">{creditNotes.map((c, i) => (
                <div key={i} className="flex justify-between text-sm"><span className="text-app">{c.voucher_number} · {fmtDate(c.voucher_date)}</span><span className="font-medium text-amber-600">{fmtINR(c.amount)}</span></div>
              ))}</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex justify-between"><span className="text-muted">{label}</span><span className="font-medium tabular-nums text-app">{value}</span></div>;
}
