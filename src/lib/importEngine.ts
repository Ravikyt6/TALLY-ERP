import { supabase } from './supabase';
import { parseExcelRows } from './parse';
import { getFinancialYear } from './format';
import * as XLSX from 'xlsx';

export interface SkippedRow {
  invoice_number: string; invoice_date: string; party_name: string;
  grand_total: number; reason: string;
}

export interface ImportResult {
  totalRows: number; imported: number; skipped: number;
  failed: number; cancelled: number; duplicates: number; batchId: string;
  failedRows: SkippedRow[]; skippedRows: SkippedRow[];
  duplicateRows: SkippedRow[]; cancelledRows: SkippedRow[];
}

export async function importExcelFile(file: File): Promise<ImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const parsed = parseExcelRows(rows);

  const batchId = crypto.randomUUID();
  let imported = 0, skipped = 0, failed = 0, cancelled = 0, duplicates = 0;
  const failedRows: SkippedRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const duplicateRows: SkippedRow[] = [];
  const cancelledRows: SkippedRow[] = [];

  const existingInvoices = new Set<string>();
  const { data: existing } = await supabase.from('sales').select('invoice_number');
  for (const s of existing ?? []) existingInvoices.add(s.invoice_number);

  for (const sale of parsed) {
    if (sale.isCancelled) { cancelled++; cancelledRows.push({ invoice_number: sale.invoice_number, invoice_date: sale.invoice_date, party_name: sale.party_name, grand_total: sale.grand_total, reason: 'Cancelled invoice' }); continue; }
    if (existingInvoices.has(sale.invoice_number)) { duplicates++; duplicateRows.push({ invoice_number: sale.invoice_number, invoice_date: sale.invoice_date, party_name: sale.party_name, grand_total: sale.grand_total, reason: 'Duplicate invoice number' }); continue; }
    if (!sale.party_name) { skipped++; skippedRows.push({ invoice_number: sale.invoice_number, invoice_date: sale.invoice_date, party_name: '', grand_total: sale.grand_total, reason: 'Missing party name' }); continue; }

    try {
      const { data: party } = await supabase.from('parties').select('id').eq('name', sale.party_name).maybeSingle();
      let partyId = party?.id;
      if (!partyId) {
        const { data: newParty, error: pErr } = await supabase.from('parties').insert({
          name: sale.party_name, gstin: sale.party_gstin, state: sale.state,
        }).select().single();
        if (pErr) throw pErr;
        partyId = (newParty as { id: string }).id;
      }

      const { data: saleRec, error: sErr } = await supabase.from('sales').insert({
        invoice_number: sale.invoice_number, invoice_date: sale.invoice_date, party_id: partyId,
        subtotal: sale.subtotal, discount: sale.discount, cgst: sale.cgst, sgst: sale.sgst, igst: sale.igst,
        shipping: sale.shipping, round_off: sale.round_off, grand_total: sale.grand_total,
        taxable_value: sale.taxable_value ?? 0, sale_amount: sale.sale_amount ?? 0,
        gross_invoice_total: sale.gross_invoice_total ?? 0, packing_charges: sale.packing_charges ?? 0,
        state: sale.state, buyer_address: sale.buyer_address, consignee: sale.consignee,
        status: 'unpaid', financial_year: getFinancialYear(new Date(sale.invoice_date)),
        import_batch_id: batchId, outstanding: sale.grand_total, received: 0, due: sale.grand_total,
        expense: 0, expense_breakdown: {}, sales_person: null,
      }).select().single();
      if (sErr) throw sErr;
      const saleId = (saleRec as { id: string }).id;

      for (const item of sale.items) {
        const { data: master } = await supabase.from('item_master').select('id, cost_price').eq('base_name', item.item_name).maybeSingle();
        const costPrice = (master as { cost_price?: number } | null)?.cost_price ?? 0;

        const { error: iErr } = await supabase.from('sale_items').insert({
          sale_id: saleId, name: item.item_name, quantity: item.quantity,
          rate: item.rate, amount: item.amount, returned_qty: 0, cost_price: costPrice,
        });
        if (iErr) throw iErr;

        if (!master) {
          await supabase.from('item_master').insert({ base_name: item.item_name, stock_qty: -item.quantity });
        } else {
          await supabase.rpc('update_stock_qty', { p_sku: item.item_name, p_qty: -item.quantity });
        }
      }

      await supabase.rpc('recompute_sale_profit', { p_sale_id: saleId });

      await supabase.from('ledger_entries').insert({
        party_id: partyId, voucher_type: 'sale', voucher_id: saleId,
        voucher_number: sale.invoice_number, voucher_date: sale.invoice_date,
        particular: `Sale ${sale.invoice_number}`, debit: sale.grand_total, credit: 0,
        financial_year: getFinancialYear(new Date(sale.invoice_date)), import_batch_id: batchId,
      });

      existingInvoices.add(sale.invoice_number);
      imported++;
    } catch (e) {
      failed++;
      const reason = e instanceof Error ? e.message : String(e);
      failedRows.push({ invoice_number: sale.invoice_number, invoice_date: sale.invoice_date, party_name: sale.party_name, grand_total: sale.grand_total, reason });
      console.error(`Import failed for invoice ${sale.invoice_number}:`, reason);
    }
  }

  const payload = {
    file_name: file.name,
    voucher_type: 'sale',
    rows_total: parsed.length,
    rows_imported: imported,
    rows_skipped: skipped,
    rows_failed: failed,
    rows_cancelled: cancelled,
    rows_duplicates: duplicates,
    batch_id: batchId,
    notes: `Batch ${batchId}`,
  };

  console.log('Import History Payload', payload);

  const requiredFields: (keyof typeof payload)[] = [
    'file_name', 'voucher_type', 'rows_total', 'rows_imported', 'rows_failed', 'rows_skipped',
  ];
  for (const field of requiredFields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      const msg = `Missing required field for import_history: ${String(field)}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  try {
    const { data, error } = await supabase.from('import_history').insert(payload).select();
    if (error) {
      console.error('Supabase import_history insert failed:', {
        status: (error as { status?: number }).status,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        failedPayload: payload,
      });
      throw new Error(
        `Import History insert failed — Code: ${error.code}, Message: ${error.message}, Payload: ${JSON.stringify(payload)}`,
      );
    }
    console.log('Import History SQL response:', data);
  } catch (e) {
    console.error('Import History insert exception:', e);
    throw e;
  }

  return { totalRows: parsed.length, imported, skipped, failed, cancelled, duplicates, batchId, failedRows, skippedRows, duplicateRows, cancelledRows };
}
