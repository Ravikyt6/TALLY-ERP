import { supabase, type Sale, type SaleItem, type Party, type LedgerEntry, type ImportHistory, type ItemGroup, type ItemGroupMapping, type ItemMaster, type RtoEntry } from './supabase';

export type { ItemGroup, ItemGroupMapping, ItemMaster, RtoEntry, Sale, SaleItem, Party, LedgerEntry, ImportHistory };

export interface DashboardStats {
  todaySale: number; monthSale: number; totalReturned: number;
  netRevenue: number; totalProfit: number; totalParties: number; totalInvoices: number;
}

function sumExpense(breakdown: Record<string, number> | null, fallback: number | null): number {
  if (breakdown && Object.keys(breakdown).length > 0) return Object.values(breakdown).reduce((s, v) => s + (v || 0), 0);
  return fallback ?? 0;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { data: todayData } = await supabase.from('sales').select('grand_total').eq('invoice_date', todayStr);
  const { data: monthData } = await supabase.from('sales').select('grand_total').gte('invoice_date', monthStart);
  const { count: partyCount } = await supabase.from('parties').select('*', { count: 'exact', head: true });
  const { count: invoiceCount } = await supabase.from('sales').select('*', { count: 'exact', head: true });

  const todaySale = (todayData ?? []).reduce((s, r) => s + (r.grand_total ?? 0), 0);
  const monthSale = (monthData ?? []).reduce((s, r) => s + (r.grand_total ?? 0), 0);

  const { data: rtoData } = await supabase.from('rto_entries').select('return_value');
  const totalReturned = (rtoData ?? []).reduce((s, r) => s + (r.return_value ?? 0), 0);

  const { data: salesForTotal } = await supabase.from('sales').select('grand_total, profit');
  const totalGrand = (salesForTotal ?? []).reduce((s, r) => s + (r.grand_total ?? 0), 0);
  const totalProfit = (salesForTotal ?? []).reduce((s, r) => s + (r.profit ?? 0), 0);

  return {
    todaySale, monthSale, totalReturned, netRevenue: totalGrand - totalReturned,
    totalProfit, totalParties: partyCount ?? 0, totalInvoices: invoiceCount ?? 0,
  };
}

export interface TopPartyBySale {
  party_id: string; party_name: string; total_sale: number; invoice_count: number; total_profit: number;
}

export async function fetchTopPartiesBySale(limit = 10): Promise<TopPartyBySale[]> {
  const { data, error } = await supabase
    .from('sales').select('party_id, grand_total, profit, parties!inner ( name )');
  if (error) throw error;

  const map = new Map<string, { party_name: string; total_sale: number; invoice_count: number; total_profit: number }>();
  for (const r of data ?? []) {
    const pid = r.party_id as string;
    const cur = map.get(pid) ?? { party_name: ((r.parties as { name: string }[] | { name: string }) as { name: string })?.name ?? '—', total_sale: 0, invoice_count: 0, total_profit: 0 };
    cur.total_sale += r.grand_total ?? 0;
    cur.total_profit += r.profit ?? 0;
    cur.invoice_count++;
    map.set(pid, cur);
  }
  return Array.from(map.entries())
    .map(([party_id, v]) => ({ party_id, ...v }))
    .sort((a, b) => b.total_sale - a.total_sale)
    .slice(0, limit);
}

export interface TopPartyPurchaseFrequency {
  party_id: string; party_name: string; purchase_count: number; total_amount: number; total_profit: number;
}

export async function fetchTopPartiesByPurchaseFrequencyLast3Months(limit = 10): Promise<TopPartyPurchaseFrequency[]> {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  const startStr = threeMonthsAgo.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('sales').select('party_id, grand_total, profit, parties!inner ( name )')
    .gte('invoice_date', startStr);
  if (error) throw error;

  const map = new Map<string, { party_name: string; purchase_count: number; total_amount: number; total_profit: number }>();
  for (const r of data ?? []) {
    const pid = r.party_id as string;
    const cur = map.get(pid) ?? { party_name: ((r.parties as { name: string }[] | { name: string }) as { name: string })?.name ?? '—', purchase_count: 0, total_amount: 0, total_profit: 0 };
    cur.purchase_count++;
    cur.total_amount += r.grand_total ?? 0;
    cur.total_profit += r.profit ?? 0;
    map.set(pid, cur);
  }
  return Array.from(map.entries())
    .map(([party_id, v]) => ({ party_id, ...v }))
    .sort((a, b) => b.purchase_count - a.purchase_count)
    .slice(0, limit);
}

export interface MonthlyTrendPoint {
  month: string; label: string; total_sale: number; total_profit: number; invoice_count: number;
}

export async function fetchMonthlyTrend(months = 12): Promise<MonthlyTrendPoint[]> {
  const now = new Date();
  const points: MonthlyTrendPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    points.push({ month: key, label: MONTH_NAMES_SHORT[d.getMonth()] + " '" + String(d.getFullYear()).slice(2), total_sale: 0, total_profit: 0, invoice_count: 0 });
  }
  const startStr = points[0].month + '-01';
  const { data, error } = await supabase
    .from('sales').select('invoice_date, grand_total, profit')
    .gte('invoice_date', startStr);
  if (error) throw error;
  for (const r of data ?? []) {
    const key = (r.invoice_date as string).slice(0, 7);
    const pt = points.find(p => p.month === key);
    if (pt) { pt.total_sale += r.grand_total ?? 0; pt.total_profit += r.profit ?? 0; pt.invoice_count++; }
  }
  return points;
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthlySalesPersonStat {
  sales_person: string; invoice_count: number; total_sale: number;
  total_returned: number; total_expense: number; total_cost: number; profit: number;
}

export async function fetchMonthlySalesPersonStats(year: number, month: number): Promise<MonthlySalesPersonStat[]> {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);

  const { data: sales, error } = await supabase
    .from('sales').select('id, sales_person, grand_total, expense, expense_breakdown, profit')
    .gte('invoice_date', monthStart).lte('invoice_date', monthEnd);
  if (error) throw error;

  const saleRows = (sales ?? []) as { id: string; sales_person: string | null; grand_total: number; expense: number | null; expense_breakdown: Record<string, number> | null; profit: number | null }[];
  const saleIds = saleRows.map(s => s.id);

  const rtoMap = new Map<string, number>();
  const costMap = new Map<string, number>();
  if (saleIds.length > 0) {
    for (let i = 0; i < saleIds.length; i += 500) {
      const chunk = saleIds.slice(i, i + 500);
      const { data: rtos } = await supabase.from('rto_entries').select('sale_id, return_value').in('sale_id', chunk);
      for (const r of rtos ?? []) rtoMap.set(r.sale_id, (rtoMap.get(r.sale_id) ?? 0) + (r.return_value ?? 0));
      const { data: items } = await supabase.from('sale_items').select('sale_id, quantity, returned_qty, cost_price').in('sale_id', chunk);
      for (const it of items ?? []) {
        const netQty = (it.quantity ?? 0) - (it.returned_qty ?? 0);
        costMap.set(it.sale_id, (costMap.get(it.sale_id) ?? 0) + netQty * (it.cost_price ?? 0));
      }
    }
  }

  const byPerson = new Map<string, { invoice_count: number; total_sale: number; total_returned: number; total_expense: number; total_cost: number; profit: number }>();
  for (const s of saleRows) {
    const person = s.sales_person?.trim() || 'Unassigned';
    const cur = byPerson.get(person) ?? { invoice_count: 0, total_sale: 0, total_returned: 0, total_expense: 0, total_cost: 0, profit: 0 };
    cur.invoice_count++;
    cur.total_sale += s.grand_total ?? 0;
    cur.total_returned += rtoMap.get(s.id) ?? 0;
    cur.total_expense += sumExpense(s.expense_breakdown, s.expense);
    cur.total_cost += costMap.get(s.id) ?? 0;
    cur.profit += s.profit ?? 0;
    byPerson.set(person, cur);
  }

  return Array.from(byPerson.entries()).map(([sales_person, v]) => ({ sales_person, ...v })).sort((a, b) => b.profit - a.profit);
}

export interface RecentTxn {
  id: string; invoice_number: string; invoice_date: string; party_name: string;
  grand_total: number; sale_amount: number | null; outstanding: number | null;
  status: string; sales_person: string | null;
}

export async function fetchRecentTransactions(limit = 8): Promise<RecentTxn[]> {
  const { data, error } = await supabase
    .from('sales').select('id, invoice_number, invoice_date, party_id, grand_total, sale_amount, outstanding, status, sales_person, parties!inner ( name )')
    .order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const party = r.parties as { name: string };
    return {
      id: r.id as string, invoice_number: r.invoice_number as string,
      invoice_date: r.invoice_date as string, party_name: party?.name ?? '—',
      grand_total: r.grand_total as number, sale_amount: (r.sale_amount as number | null) ?? null,
      outstanding: (r.outstanding as number | null) ?? null, status: r.status as string,
      sales_person: (r.sales_person as string | null) ?? null,
    };
  });
}

export async function fetchAllTransactions(): Promise<RecentTxn[]> {
  const { data, error } = await supabase
    .from('sales').select('id, invoice_number, invoice_date, party_id, grand_total, sale_amount, outstanding, status, sales_person, parties!inner ( name )')
    .order('invoice_date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const party = r.parties as { name: string };
    return {
      id: r.id as string, invoice_number: r.invoice_number as string,
      invoice_date: r.invoice_date as string, party_name: party?.name ?? '—',
      grand_total: r.grand_total as number, sale_amount: (r.sale_amount as number | null) ?? null,
      outstanding: (r.outstanding as number | null) ?? null, status: r.status as string,
      sales_person: (r.sales_person as string | null) ?? null,
    };
  });
}

export interface PartyWithBalance {
  id: string; name: string; gstin: string | null; state: string | null;
  balance: number; totalSale: number; totalReturned: number;
}

export async function fetchPartiesWithBalances(): Promise<PartyWithBalance[]> {
  const { data: parties, error } = await supabase.from('parties').select('*').order('name');
  if (error) throw error;

  const { data: sales } = await supabase.from('sales').select('id, party_id, grand_total, sale_amount, outstanding');
  const salesRows = (sales ?? []) as { id: string; party_id: string; grand_total: number; sale_amount: number | null; outstanding: number | null }[];

  const { data: rtos } = await supabase.from('rto_entries').select('sale_id, return_value');
  const rtoRows = (rtos ?? []) as { sale_id: string; return_value: number | null }[];

  const saleMap = new Map<string, { total: number; outstanding: number }>();
  for (const s of salesRows) {
    const cur = saleMap.get(s.party_id) ?? { total: 0, outstanding: 0 };
    cur.total += s.sale_amount ?? s.grand_total ?? 0;
    cur.outstanding += s.outstanding ?? 0;
    saleMap.set(s.party_id, cur);
  }

  const saleIdToParty = new Map<string, string>();
  for (const s of salesRows) saleIdToParty.set(s.id, s.party_id);

  const rtoByParty = new Map<string, number>();
  for (const r of rtoRows) {
    const pid = saleIdToParty.get(r.sale_id);
    if (pid) rtoByParty.set(pid, (rtoByParty.get(pid) ?? 0) + (r.return_value ?? 0));
  }

  return (parties ?? []).map((p: Party) => {
    const s = saleMap.get(p.id) ?? { total: 0, outstanding: 0 };
    return {
      id: p.id, name: p.name, gstin: p.gstin, state: p.state,
      balance: s.outstanding, totalSale: s.total, totalReturned: rtoByParty.get(p.id) ?? 0,
    };
  });
}

export interface LedgerRow {
  id: string; entry_date: string; voucher_type: string; voucher_number: string | null;
  voucher_id: string | null; particular: string | null; debit: number; credit: number; profit: number;
}

export async function fetchPartyLedger(partyId: string): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from('ledger_entries').select('*').eq('party_id', partyId)
    .order('voucher_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
  if (error) throw error;

  const entries = (data ?? []) as LedgerEntry[];
  const saleIds = entries.filter(e => e.voucher_type === 'sale' && e.voucher_id).map(e => e.voucher_id!) as string[];

  const saleProfitMap = new Map<string, number>();
  if (saleIds.length > 0) {
    for (let i = 0; i < saleIds.length; i += 500) {
      const chunk = saleIds.slice(i, i + 500);
      const { data: saleRecs } = await supabase.from('sales').select('id, profit').in('id', chunk);
      for (const s of saleRecs ?? []) saleProfitMap.set(s.id, s.profit ?? 0);
    }
  }

  return entries.map((e) => {
    const profit = (e.voucher_type === 'sale' && e.voucher_id) ? (saleProfitMap.get(e.voucher_id) ?? 0) : 0;
    return {
      id: e.id, entry_date: e.voucher_date ?? e.entry_date ?? e.created_at,
      voucher_type: e.voucher_type, voucher_number: e.voucher_number ?? e.voucher_id,
      voucher_id: e.voucher_id, particular: e.particular ?? '',
      debit: e.debit ?? 0, credit: e.credit ?? 0, profit,
    };
  });
}

export interface PartySummary {
  party: Party; totalSale: number; totalReturned: number; netSale: number; outstanding: number; totalProfit: number;
}

export async function fetchPartySummary(partyId: string): Promise<PartySummary> {
  const { data: party } = await supabase.from('parties').select('*').eq('id', partyId).maybeSingle();
  const { data: sales } = await supabase.from('sales').select('id, grand_total, outstanding, profit').eq('party_id', partyId);
  const saleIds = (sales ?? []).map(s => s.id);

  let totalReturned = 0, totalProfit = 0, totalSale = 0, outstanding = 0;

  for (const s of sales ?? []) {
    totalSale += s.grand_total ?? 0;
    outstanding += s.outstanding ?? 0;
    totalProfit += s.profit ?? 0;
  }

  if (saleIds.length > 0) {
    for (let i = 0; i < saleIds.length; i += 500) {
      const chunk = saleIds.slice(i, i + 500);
      const { data: rtoRows } = await supabase.from('rto_entries').select('return_value').in('sale_id', chunk);
      for (const r of rtoRows ?? []) totalReturned += r.return_value ?? 0;
    }
  }

  return { party: party as Party, totalSale, totalReturned, netSale: totalSale - totalReturned, outstanding, totalProfit };
}

export interface SaleWithParty extends Sale {
  party_name: string; party_gstin: string | null; returned_amount: number;
  net_sale: number; profit: number; rto_status: string; item_names: string[];
}

export async function fetchSales(filters?: { dateFrom?: string; dateTo?: string; month?: string }): Promise<SaleWithParty[]> {
  let query = supabase
    .from('sales').select('*, parties!inner ( name, gstin )')
    .order('invoice_date', { ascending: false }).order('created_at', { ascending: false });

  if (filters?.dateFrom) query = query.gte('invoice_date', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('invoice_date', filters.dateTo);
  if (filters?.month) {
    const [y, m] = filters.month.split('-');
    const start = `${y}-${m}-01`;
    const end = new Date(parseInt(y), parseInt(m), 0).toISOString().slice(0, 10);
    query = query.gte('invoice_date', start).lte('invoice_date', end);
  }

  const { data: sales, error } = await query;
  if (error) throw error;

  const rows = (sales ?? []) as (Sale & { parties: { name: string; gstin: string | null } })[];
  if (rows.length === 0) return [];

  const saleIds = rows.map(r => r.id);
  const saleItemMap = new Map<string, { returned: number; itemNames: string[] }>();

  for (let i = 0; i < saleIds.length; i += 500) {
    const chunk = saleIds.slice(i, i + 500);
    const { data: items } = await supabase.from('sale_items').select('sale_id, name, quantity, returned_qty, rate').in('sale_id', chunk);
    for (const it of items ?? []) {
      const cur = saleItemMap.get(it.sale_id) ?? { returned: 0, itemNames: [] };
      const rQty = it.returned_qty ?? 0;
      cur.returned += rQty * (it.rate ?? 0);
      if (it.name) cur.itemNames.push(it.name);
      saleItemMap.set(it.sale_id, cur);
    }
  }

  return rows.map((s) => {
    const info = saleItemMap.get(s.id) ?? { returned: 0, itemNames: [] };
    const saleAmt = s.grand_total ?? 0;
    const returned_amount = info.returned;
    const net_sale = saleAmt - returned_amount;
    const profit = s.profit ?? 0;
    let rto_status = 'completed';
    if (returned_amount >= saleAmt && returned_amount > 0) rto_status = 'fully_returned';
    else if (returned_amount > 0) rto_status = 'partial_return';
    return {
      ...s, party_name: s.parties?.name ?? '—', party_gstin: s.parties?.gstin ?? null,
      returned_amount, net_sale, profit, rto_status, item_names: info.itemNames,
    } as SaleWithParty;
  });
}

export async function fetchSaleItems(saleId: string): Promise<SaleItem[]> {
  const { data, error } = await supabase.from('sale_items').select('*').eq('sale_id', saleId);
  if (error) throw error;
  return (data ?? []) as SaleItem[];
}

export async function updateSaleExpense(saleId: string, expenseBreakdown: Record<string, number>): Promise<void> {
  const totalExpense = Object.values(expenseBreakdown).reduce((s, v) => s + (v || 0), 0);
  const { error } = await supabase.from('sales').update({ expense_breakdown: expenseBreakdown, expense: totalExpense }).eq('id', saleId);
  if (error) throw error;
}

export async function updateSalePerson(saleId: string, salesPerson: string | null): Promise<void> {
  const { error } = await supabase.from('sales').update({ sales_person: salesPerson }).eq('id', saleId);
  if (error) throw error;
}

export interface RtoItemInput {
  sale_item_id: string; item_name: string; returned_qty: number;
  reason: string; return_date: string; remarks: string;
}

export async function processRto(saleId: string, items: RtoItemInput[]): Promise<{ success: boolean; total_return_value: number }> {
  const itemsJson = JSON.stringify(items.map(it => ({
    sale_item_id: it.sale_item_id, item_name: it.item_name, returned_qty: it.returned_qty,
    reason: it.reason, return_date: it.return_date, remarks: it.remarks,
  })));
  const { data, error } = await supabase.rpc('process_rto', { p_sale_id: saleId, p_items: itemsJson });
  if (error) throw error;
  return (data as { success: boolean; total_return_value: number }) ?? { success: true, total_return_value: 0 };
}

export interface RtoReportRow {
  id: string; invoice_number: string; party_name: string; item_name: string;
  quantity_sold: number; returned_qty: number; return_value: number; reason: string; return_date: string;
}

export async function fetchRtoReport(filters?: { dateFrom?: string; dateTo?: string; search?: string }): Promise<RtoReportRow[]> {
  let query = supabase
    .from('rto_entries')
    .select(`id, sale_id, sale_item_id, item_name, returned_qty, reason, return_date, return_value, sales!inner ( invoice_number, party_id, parties!inner ( name ) )`)
    .order('return_date', { ascending: false });

  if (filters?.dateFrom) query = query.gte('return_date', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('return_date', filters.dateTo);

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data ?? []).map((r: Record<string, unknown>) => {
    const sale = r.sales as { invoice_number: string; party_id: string; parties: { name: string } };
    return {
      id: r.id as string, invoice_number: sale.invoice_number,
      party_name: sale.parties?.name ?? '—', item_name: r.item_name as string,
      quantity_sold: 0, returned_qty: r.returned_qty as number,
      return_value: r.return_value as number, reason: r.reason as string,
      return_date: r.return_date as string,
    } as RtoReportRow;
  });

  const saleIds = Array.from(new Set((data ?? []).map((r: Record<string, unknown>) => r.sale_id as string)));
  const qtyMap = new Map<string, number>();
  for (let i = 0; i < saleIds.length; i += 500) {
    const chunk = saleIds.slice(i, i + 500);
    const { data: items } = await supabase.from('sale_items').select('sale_id, quantity').in('sale_id', chunk);
    for (const it of items ?? []) qtyMap.set(it.sale_id, (qtyMap.get(it.sale_id) ?? 0) + (it.quantity ?? 0));
  }
  const rtoSaleIdMap = new Map<string, string>();
  for (const r of (data ?? []) as Record<string, unknown>[]) rtoSaleIdMap.set(r.id as string, r.sale_id as string);
  rows = rows.map(r => ({ ...r, quantity_sold: qtyMap.get(rtoSaleIdMap.get(r.id) ?? '') ?? r.returned_qty }));

  if (filters?.search) {
    const s = filters.search.toLowerCase();
    rows = rows.filter(r =>
      r.invoice_number.toLowerCase().includes(s) || r.party_name.toLowerCase().includes(s) ||
      r.item_name.toLowerCase().includes(s) || r.reason.toLowerCase().includes(s)
    );
  }
  return rows;
}

export interface GroupCostRow { groupId: string; groupName: string; costPrice: number; skuCount: number; }

export async function fetchGroupCostRows(): Promise<GroupCostRow[]> {
  const { data: groups, error } = await supabase.from('item_groups').select('*').order('name');
  if (error) throw error;
  const { data: mappings } = await supabase.from('item_group_mappings').select('group_id');
  const countMap = new Map<string, number>();
  for (const m of mappings ?? []) countMap.set(m.group_id, (countMap.get(m.group_id) ?? 0) + 1);
  return (groups ?? []).map((g: ItemGroup) => ({
    groupId: g.id, groupName: g.name, costPrice: g.cost_price ?? 0, skuCount: countMap.get(g.id) ?? 0,
  }));
}

export async function saveGroupCostPrice(groupId: string, _groupName: string, costPrice: number): Promise<void> {
  const { error } = await supabase.from('item_groups').update({ cost_price: costPrice }).eq('id', groupId);
  if (error) throw error;

  const { data: mappings, error: mErr } = await supabase.from('item_group_mappings').select('sku_name').eq('group_id', groupId);
  if (mErr) throw mErr;
  const skuNames = (mappings ?? []).map(m => m.sku_name).filter(Boolean) as string[];
  if (skuNames.length === 0) return;

  const { error: rpcErr } = await supabase.rpc('update_cost_price_by_sku_names', {
    p_sku_names: skuNames, p_cost_price: costPrice,
  });
  if (rpcErr) throw rpcErr;
}

export async function fetchAllGroups(): Promise<ItemGroup[]> {
  const { data, error } = await supabase.from('item_groups').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as ItemGroup[];
}

export async function createGroup(name: string): Promise<ItemGroup> {
  const { data, error } = await supabase.from('item_groups').insert({ name }).select().single();
  if (error) throw error;
  return data as ItemGroup;
}

export async function updateGroup(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('item_groups').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteGroup(id: string): Promise<void> {
  const { error: mErr } = await supabase.from('item_group_mappings').delete().eq('group_id', id);
  if (mErr) throw mErr;
  const { error } = await supabase.from('item_groups').delete().eq('id', id);
  if (error) throw error;
}

export interface SkuMapping { skuName: string; groupId: string | null; groupName: string | null; baseItem: string | null; }

export async function fetchAllSkusWithMappings(): Promise<SkuMapping[]> {
  const { data: masterItems, error: mErr } = await supabase.from('item_master').select('base_name').order('base_name');
  if (mErr) throw mErr;

  const { data: saleItems, error: sErr } = await supabase.from('sale_items').select('name');
  if (sErr) throw sErr;

  const skuSet = new Map<string, string>();
  for (const it of masterItems ?? []) {
    const name = (it.base_name as string)?.trim();
    if (name) skuSet.set(name.toLowerCase(), name);
  }
  for (const it of saleItems ?? []) {
    const name = (it.name as string)?.trim();
    if (name) skuSet.set(name.toLowerCase(), name);
  }

  const { data: mappings } = await supabase.from('item_group_mappings').select('group_id, sku_name, base_item');
  const { data: groups } = await supabase.from('item_groups').select('id, name');

  const groupMap = new Map<string, string>();
  for (const g of groups ?? []) groupMap.set(g.id, g.name);

  const mappingBySku = new Map<string, { groupId: string; baseItem: string | null }>();
  for (const m of mappings ?? []) {
    const key = (m.sku_name as string)?.toLowerCase();
    if (key) mappingBySku.set(key, { groupId: m.group_id, baseItem: m.base_item });
  }

  return Array.from(skuSet).sort().map(([lowerKey, skuName]) => {
    const m = mappingBySku.get(lowerKey);
    return {
      skuName, groupId: m?.groupId ?? null,
      groupName: m?.groupId ? (groupMap.get(m.groupId) ?? null) : null,
      baseItem: m?.baseItem ?? null,
    };
  });
}

export async function assignSkuToGroup(skuName: string, groupId: string | null, baseItem?: string): Promise<void> {
  const { data: existing } = await supabase.from('item_group_mappings').select('id').eq('sku_name', skuName).maybeSingle();
  if (existing) {
    if (groupId) {
      const { error } = await supabase.from('item_group_mappings').update({ group_id: groupId, base_item: baseItem ?? null }).eq('sku_name', skuName);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('item_group_mappings').delete().eq('sku_name', skuName);
      if (error) throw error;
    }
  } else {
    if (groupId) {
      const { error } = await supabase.from('item_group_mappings').insert({ sku_name: skuName, group_id: groupId, base_item: baseItem ?? null });
      if (error) throw error;
    }
  }
}

export async function bulkAssignSkusToGroup(skuNames: string[], groupId: string): Promise<void> {
  for (const sku of skuNames) await assignSkuToGroup(sku, groupId);
}

export async function deleteSku(skuName: string): Promise<void> {
  const { error: mErr } = await supabase.from('item_group_mappings').delete().eq('sku_name', skuName);
  if (mErr) throw mErr;
  const { error: iErr } = await supabase.from('item_master').delete().eq('base_name', skuName);
  if (iErr) throw iErr;
}

export async function bulkDeleteSkus(skuNames: string[]): Promise<void> {
  if (skuNames.length === 0) return;
  const { error: mErr } = await supabase.from('item_group_mappings').delete().in('sku_name', skuNames);
  if (mErr) throw mErr;
  const { error: iErr } = await supabase.from('item_master').delete().in('base_name', skuNames);
  if (iErr) throw iErr;
}

export interface SalesPersonTemplateRow {
  invoice_number: string; invoice_date: string; party_name: string;
  party_gstin: string; sales_person: string; grand_total: number;
}

export async function fetchSalesWithoutPerson(): Promise<SalesPersonTemplateRow[]> {
  const { data, error } = await supabase
    .from('sales').select('id, invoice_number, invoice_date, grand_total, sales_person, parties!inner ( name, gstin )')
    .or('sales_person.is.null,sales_person.eq.').order('invoice_date', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r: Record<string, unknown>) => {
    const party = r.parties as { name: string; gstin: string | null };
    return {
      invoice_number: r.invoice_number as string, invoice_date: r.invoice_date as string,
      party_name: party?.name ?? '', party_gstin: party?.gstin ?? '',
      sales_person: '', grand_total: r.grand_total as number,
    } as SalesPersonTemplateRow;
  });
}

export interface BulkSalesPersonResult { updated: number; skipped: number; failed: number; total: number; }

export async function bulkAssignSalesPerson(rows: { invoice_number: string; sales_person: string }[]): Promise<BulkSalesPersonResult> {
  let updated = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const invoiceNumber = row.invoice_number?.trim();
    const salesPerson = row.sales_person?.trim();
    if (!invoiceNumber || !salesPerson) { skipped++; continue; }
    try {
      const { data: sale, error } = await supabase.from('sales').select('id').eq('invoice_number', invoiceNumber).maybeSingle();
      if (error) throw error;
      if (!sale) { skipped++; continue; }
      const { error: uErr } = await supabase.from('sales').update({ sales_person: salesPerson }).eq('id', (sale as { id: string }).id);
      if (uErr) throw uErr;
      updated++;
    } catch { failed++; }
  }
  return { updated, skipped, failed, total: rows.length };
}

export interface ItemSaleBucket {
  key: string;
  label: string;
  quantity: number;
  amount: number;
  invoice_count: number;
}

export interface ItemSaleRow {
  item_name: string;
  total_quantity: number;
  total_amount: number;
  buckets: ItemSaleBucket[];
}

export type ItemSaleMode = 'weekly' | 'monthly';

export async function fetchItemSales(
  mode: ItemSaleMode = 'weekly',
  monthsBack = 3,
  itemFilter = ''
): Promise<ItemSaleRow[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const startStr = start.toISOString().slice(0, 10);

  const { data: sales, error: sErr } = await supabase
    .from('sales').select('id, invoice_date').gte('invoice_date', startStr);
  if (sErr) throw sErr;

  const saleDateMap = new Map<string, string>();
  for (const s of sales ?? []) saleDateMap.set(s.id, s.invoice_date as string);

  const saleIds = Array.from(saleDateMap.keys());
  if (saleIds.length === 0) return [];

  const allItems: { sale_id: string; name: string; quantity: number; amount: number }[] = [];
  for (let i = 0; i < saleIds.length; i += 500) {
    const chunk = saleIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('sale_items').select('sale_id, name, quantity, amount').in('sale_id', chunk);
    if (error) throw error;
    for (const it of data ?? []) {
      allItems.push({ sale_id: it.sale_id as string, name: it.name as string, quantity: it.quantity ?? 0, amount: it.amount ?? 0 });
    }
  }

  const filtered = itemFilter.trim()
    ? allItems.filter(it => it.name.toLowerCase().includes(itemFilter.toLowerCase()))
    : allItems;

  const byItem = new Map<string, { total_quantity: number; total_amount: number; buckets: Map<string, ItemSaleBucket> }>();

  for (const it of filtered) {
    const dateStr = saleDateMap.get(it.sale_id);
    if (!dateStr) continue;
    const d = new Date(dateStr);
    let key: string, label: string;

    if (mode === 'weekly') {
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      key = weekStart.toISOString().slice(0, 10);
      label = weekStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      label = MONTH_NAMES_SHORT[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
    }

    let item = byItem.get(it.name);
    if (!item) {
      item = { total_quantity: 0, total_amount: 0, buckets: new Map() };
      byItem.set(it.name, item);
    }
    item.total_quantity += it.quantity;
    item.total_amount += it.amount;
    let bucket = item.buckets.get(key);
    if (!bucket) {
      bucket = { key, label, quantity: 0, amount: 0, invoice_count: 0 };
      item.buckets.set(key, bucket);
    }
    bucket.quantity += it.quantity;
    bucket.amount += it.amount;
    bucket.invoice_count++;
  }

  const allKeys = new Set<string>();
  for (const v of byItem.values()) for (const k of v.buckets.keys()) allKeys.add(k);
  const sortedKeys = Array.from(allKeys).sort();

  const result: ItemSaleRow[] = [];
  for (const [name, v] of byItem.entries()) {
    const buckets: ItemSaleBucket[] = sortedKeys.map(k => {
      const b = v.buckets.get(k);
      return b ?? { key: k, label: k, quantity: 0, amount: 0, invoice_count: 0 };
    });
    result.push({ item_name: name, total_quantity: v.total_quantity, total_amount: v.total_amount, buckets });
  }

  return result.sort((a, b) => b.total_amount - a.total_amount);
}

export async function fetchAllItemNames(): Promise<string[]> {
  const { data, error } = await supabase.from('sale_items').select('name');
  if (error) throw error;
  const names = new Set<string>();
  for (const r of data ?? []) names.add(r.name as string);
  return Array.from(names).sort();
}

export interface ItemPartyBreakdown {
  party_id: string;
  party_name: string;
  total_quantity: number;
  total_amount: number;
  invoice_count: number;
}

export async function fetchItemPartyBreakdown(
  itemName: string,
  monthsBack = 3,
  dateRange?: { from: string; to: string }
): Promise<ItemPartyBreakdown[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const startStr = start.toISOString().slice(0, 10);

  let query = supabase
    .from('sales')
    .select('id, party_id, invoice_date, parties!inner ( name )')
    .gte('invoice_date', startStr);
  if (dateRange) {
    query = query.gte('invoice_date', dateRange.from).lte('invoice_date', dateRange.to);
  }
  const { data: sales, error: sErr } = await query;
  if (sErr) throw sErr;

  const salePartyMap = new Map<string, string>();
  const saleIdToPartyName = new Map<string, string>();
  for (const s of sales ?? []) {
    salePartyMap.set(s.id, s.party_id as string);
    const party = s.parties as unknown as { name: string } | { name: string }[];
    const pname = Array.isArray(party) ? (party[0]?.name ?? '—') : (party?.name ?? '—');
    saleIdToPartyName.set(s.id, pname);
  }

  const saleIds = Array.from(salePartyMap.keys());
  if (saleIds.length === 0) return [];

  const matchingItemSales: { sale_id: string; quantity: number; amount: number }[] = [];
  for (let i = 0; i < saleIds.length; i += 500) {
    const chunk = saleIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('sale_items')
      .select('sale_id, quantity, amount')
      .in('sale_id', chunk)
      .ilike('name', itemName);
    if (error) throw error;
    for (const it of data ?? []) {
      matchingItemSales.push({ sale_id: it.sale_id as string, quantity: it.quantity ?? 0, amount: it.amount ?? 0 });
    }
  }

  const byParty = new Map<string, { party_name: string; total_quantity: number; total_amount: number; invoice_count: Set<string> }>();
  for (const it of matchingItemSales) {
    const pid = salePartyMap.get(it.sale_id);
    if (!pid) continue;
    const pname = saleIdToPartyName.get(it.sale_id) ?? '—';
    const cur = byParty.get(pid) ?? { party_name: pname, total_quantity: 0, total_amount: 0, invoice_count: new Set() };
    cur.total_quantity += it.quantity;
    cur.total_amount += it.amount;
    cur.invoice_count.add(it.sale_id);
    byParty.set(pid, cur);
  }

  return Array.from(byParty.entries())
    .map(([party_id, v]) => ({ party_id, party_name: v.party_name, total_quantity: v.total_quantity, total_amount: v.total_amount, invoice_count: v.invoice_count.size }))
    .sort((a, b) => b.total_amount - a.total_amount);
}
