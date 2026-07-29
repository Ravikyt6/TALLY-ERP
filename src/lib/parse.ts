export interface ParsedSale {
  invoice_number: string; invoice_date: string; party_name: string;
  party_gstin: string | null; subtotal: number; discount: number;
  cgst: number; sgst: number; igst: number; shipping: number;
  round_off: number; grand_total: number; taxable_value: number | null;
  sale_amount: number | null; gross_invoice_total: number | null;
  packing_charges: number | null; state: string | null;
  buyer_address: string | null; consignee: string | null;
  items: ParsedSaleItem[]; isCancelled: boolean;
}

export interface ParsedSaleItem {
  item_name: string; hsn: string | null; quantity: number;
  rate: number; amount: number; gst_rate: number | null;
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,₹\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function excelDate(v: unknown): string {
  if (v == null || v === '') return new Date().toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!isNaN(n) && n > 30000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = str(v);
  return s || new Date().toISOString().slice(0, 10);
}

function isCancelledRow(row: Record<string, unknown>): boolean {
  const voucherType = str(row['Voucher Type'] ?? row['voucher_type'] ?? '');
  if (voucherType.toLowerCase().includes('cancel')) return true;
  for (const v of Object.values(row)) {
    if (v == null) continue;
    const s = String(v).toLowerCase().trim();
    if (s === 'cancelled' || s === 'cancel' || s.includes('cancelled')) return true;
  }
  return false;
}

export function parseExcelRows(rows: Record<string, unknown>[]): ParsedSale[] {
  const sales: ParsedSale[] = [];
  let current: ParsedSale | null = null;

  for (const row of rows) {
    const rowCancelled = isCancelledRow(row);

    const inv = str(row['Voucher No.'] ?? row['Invoice No'] ?? row['invoice_no'] ?? row['Voucher Number'] ?? row['voucher_number'] ?? row['Invoice Number'] ?? row['Voucher No']);
    const party = str(row['Buyer'] ?? row['Party Name'] ?? row['party_name'] ?? row['Party'] ?? row['Buyer Name'] ?? row['party']);
    const date = excelDate(row['Date'] ?? row['date'] ?? row['Invoice Date'] ?? row['invoice_date']);

    if (inv && inv !== (current as ParsedSale | null)?.invoice_number) {
      if (current) sales.push(current);
      current = {
        invoice_number: inv, invoice_date: date || new Date().toISOString().slice(0, 10),
        party_name: party,
        party_gstin: str(row['GSTIN/UIN'] ?? row['Party GSTIN'] ?? row['party_gstin'] ?? row['GSTIN'] ?? row['Buyer GSTIN']) || null,
        subtotal: num(row['Subtotal'] ?? row['subtotal'] ?? row['Value'] ?? row['SALE']),
        discount: num(row['Discount'] ?? row['discount']),
        cgst: num(row['CGST'] ?? row['cgst'] ?? row['OUTPUT CGST 5%'] ?? row['OUTPUT CGST 12%'] ?? row['OUTPUT CGST 18%'] ?? row['OUTPUT CGST 28%']),
        sgst: num(row['SGST'] ?? row['sgst'] ?? row['OUTPUT SGST 5%'] ?? row['OUTPUT SGST 12%'] ?? row['OUTPUT SGST 18%'] ?? row['OUTPUT SGST 28%']),
        igst: num(row['IGST'] ?? row['igst'] ?? row['OUTPUT IGST 5%'] ?? row['OUTPUT IGST 12%'] ?? row['OUTPUT IGST 18%'] ?? row['OUTPUT IGST 28%']),
        shipping: num(row['Shipping'] ?? row['shipping'] ?? row['Freight'] ?? row['freight'] ?? row['Shipping Received']),
        round_off: num(row['Round Off'] ?? row['round_off'] ?? row['Rounded Off'] ?? row['roundoff']),
        grand_total: num(row['Gross Total'] ?? row['Grand Total'] ?? row['grand_total'] ?? row['Total'] ?? row['total'] ?? row['SALE']),
        taxable_value: num(row['Taxable Value'] ?? row['taxable_value'] ?? row['Value'] ?? 0) || null,
        sale_amount: num(row['SALE'] ?? row['Sale Amount'] ?? row['sale_amount'] ?? 0) || null,
        gross_invoice_total: num(row['Gross Total'] ?? row['Gross Invoice Total'] ?? row['gross_invoice_total'] ?? 0) || null,
        packing_charges: num(row['Packing Charges'] ?? row['packing_charges'] ?? 0) || null,
        state: str(row['State'] ?? row['state']) || null,
        buyer_address: str(row['Buyer Address'] ?? row['buyer_address'] ?? row['Address']) || null,
        consignee: str(row['Consignee'] ?? row['consignee']) || null,
        items: [], isCancelled: rowCancelled,
      };
    } else if (rowCancelled && current) {
      current.isCancelled = true;
    }

    const itemName = str(row['Particulars'] ?? row['Item Name'] ?? row['item_name'] ?? row['Item'] ?? row['Particular'] ?? row['particular']);
    if (itemName && current) {
      current.items.push({
        item_name: itemName,
        hsn: str(row['HSN'] ?? row['hsn'] ?? row['HSN/SAC']) || null,
        quantity: num(row['Quantity'] ?? row['quantity'] ?? row['Qty'] ?? row['qty']),
        rate: num(row['Rate'] ?? row['rate'] ?? row['Price'] ?? row['price']),
        amount: num(row['Value'] ?? row['Amount'] ?? row['amount']),
        gst_rate: num(row['GST Rate'] ?? row['gst_rate'] ?? row['GST%'] ?? 0) || null,
      });
    }
  }

  if (current) sales.push(current);
  return sales.filter(s => s.invoice_number);
}
