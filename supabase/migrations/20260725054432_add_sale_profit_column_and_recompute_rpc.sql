/*
# Add profit column to sales + recompute_sale_profit RPC

## Purpose
Profit is currently computed client-side everywhere (dashboard, sales list,
ledger, party summary). This causes inconsistency and repeated heavy queries.
This migration stores profit directly on the sales table as a single source
of truth: profit = grand_total - returned_value - total_cost - total_expense.

## Changes
1. New column: `sales.profit` (numeric, default 0) — net profit after expense.
2. New RPC: `recompute_sale_profit(p_sale_id uuid)` — recomputes and updates
   the profit column for a single sale. Returns the new profit value.
3. New RPC: `recompute_all_sale_profits()` — backfills profit for every sale.
4. Updated `process_rto` — after processing returns, calls recompute_sale_profit
   so the sale's profit reflects the return.
5. Updated `update_cost_price_by_sku_names` — after updating cost prices,
   recomputes profit for all affected sales.
6. Backfill: runs recompute_all_sale_profits() once at the end.

## Security
- No new tables, no RLS changes.
- RPCs are SECURITY DEFINER, granted to anon + authenticated (single-tenant).
*/

-- 1. Add profit column to sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS profit numeric NOT NULL DEFAULT 0;

-- 2. recompute_sale_profit(p_sale_id) -> numeric
CREATE OR REPLACE FUNCTION public.recompute_sale_profit(p_sale_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_grand_total numeric;
  v_expense numeric;
  v_expense_breakdown jsonb;
  v_total_cost numeric DEFAULT 0;
  v_total_return numeric DEFAULT 0;
  v_profit numeric;
  v_row RECORD;
BEGIN
  SELECT grand_total, expense, expense_breakdown INTO v_grand_total, v_expense, v_expense_breakdown
  FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  -- total cost from sale_items (net qty * cost_price)
  FOR v_row IN
    SELECT (quantity - COALESCE(returned_qty, 0)) * COALESCE(cost_price, 0) AS line_cost
    FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    v_total_cost := v_total_cost + v_row.line_cost;
  END LOOP;

  -- total return value from rto_entries
  SELECT COALESCE(SUM(return_value), 0) INTO v_total_return
  FROM rto_entries WHERE sale_id = p_sale_id;

  -- expense: prefer breakdown sum, fall back to expense column
  IF v_expense_breakdown IS NOT NULL AND v_expense_breakdown::text <> '{}' AND v_expense_breakdown::text <> 'null' THEN
    SELECT COALESCE(SUM((value::text)::numeric), 0) INTO v_expense
    FROM jsonb_each_text(v_expense_breakdown);
  END IF;
  v_expense := COALESCE(v_expense, 0);

  v_profit := COALESCE(v_grand_total, 0) - v_total_return - v_total_cost - v_expense;

  UPDATE sales SET profit = v_profit WHERE id = p_sale_id;

  RETURN v_profit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_sale_profit(uuid) TO anon, authenticated;

-- 3. recompute_all_sale_profits() -> void
CREATE OR REPLACE FUNCTION public.recompute_all_sale_profits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM sales ORDER BY created_at LOOP
    PERFORM public.recompute_sale_profit(v_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_all_sale_profits() TO anon, authenticated;

-- 4. Update process_rto to recompute profit after processing returns
CREATE OR REPLACE FUNCTION process_rto(p_sale_id uuid, p_items text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_sale RECORD;
  v_return_value numeric;
  v_total_return numeric DEFAULT 0;
  v_returned_qty numeric;
  v_rate numeric;
  v_amount numeric;
  v_qty numeric;
  v_item_name text;
  v_reason text;
  v_return_date date;
  v_remarks text;
  v_sale_item_id uuid;
BEGIN
  v_items := p_items::jsonb;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    v_returned_qty := (v_item->>'returned_qty')::numeric;
    v_item_name := v_item->>'item_name';
    v_reason := v_item->>'reason';
    v_return_date := (v_item->>'return_date')::date;
    v_remarks := v_item->>'remarks';

    SELECT quantity, rate, amount INTO v_qty, v_rate, v_amount
    FROM sale_items WHERE id = v_sale_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale item not found: %', v_sale_item_id;
    END IF;

    IF v_qty > 0 THEN
      v_return_value := (v_amount / v_qty) * v_returned_qty;
    ELSE
      v_return_value := v_rate * v_returned_qty;
    END IF;

    v_total_return := v_total_return + v_return_value;

    UPDATE sale_items
    SET returned_qty = returned_qty + v_returned_qty
    WHERE id = v_sale_item_id;

    INSERT INTO rto_entries (
      sale_id, sale_item_id, party_id, item_name,
      quantity_sold, returned_qty, rate, return_value,
      reason, return_date, remarks, financial_year, company
    ) VALUES (
      p_sale_id, v_sale_item_id, v_sale.party_id, v_item_name,
      v_qty, v_returned_qty, v_rate, v_return_value,
      v_reason, v_return_date, v_remarks,
      v_sale.financial_year, v_sale.company
    );

    UPDATE item_master
    SET stock_qty = stock_qty + v_returned_qty, updated_at = now()
    WHERE base_name = v_item_name;

    IF NOT FOUND THEN
      INSERT INTO item_master (base_name, stock_qty, cost_price)
      VALUES (v_item_name, v_returned_qty, 0)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO ledger_entries (
    party_id, voucher_type, voucher_id, voucher_number,
    voucher_date, financial_year, company, particular,
    debit, credit
  ) VALUES (
    v_sale.party_id,
    'rto_adjustment',
    p_sale_id,
    v_sale.invoice_number || '-RTO',
    CURRENT_DATE,
    v_sale.financial_year,
    v_sale.company,
    'RTO Adjustment for ' || v_sale.invoice_number,
    0,
    v_total_return
  );

  -- Recompute profit so sales.profit reflects the return
  PERFORM public.recompute_sale_profit(p_sale_id);

  RETURN jsonb_build_object(
    'success', true,
    'total_return_value', v_total_return,
    'sale_id', p_sale_id,
    'party_id', v_sale.party_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_rto(uuid, text) TO anon, authenticated;

-- 5. Update update_cost_price_by_sku_names to recompute profit for affected sales
CREATE OR REPLACE FUNCTION update_cost_price_by_sku_names(
  p_sku_names text[],
  p_cost_price numeric
) RETURNS void AS $$
DECLARE
  v_sale_ids uuid[];
BEGIN
  UPDATE sale_items
  SET cost_price = p_cost_price
  WHERE name = ANY(p_sku_names);

  -- Recompute profit for every sale that contains these items
  SELECT DISTINCT sale_id INTO v_sale_ids FROM sale_items WHERE name = ANY(p_sku_names);
  -- v_sale_ids is an array; iterate manually
  IF v_sale_ids IS NOT NULL THEN
    FOR i IN 1..array_length(v_sale_ids, 1) LOOP
      PERFORM public.recompute_sale_profit(v_sale_ids[i]);
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_cost_price_by_sku_names(text[], numeric) TO anon, authenticated;

-- 6. Backfill profit for all existing sales
SELECT public.recompute_all_sale_profits();
