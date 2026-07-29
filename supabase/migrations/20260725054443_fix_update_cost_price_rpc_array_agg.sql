/*
# Fix update_cost_price_by_sku_names array aggregation

The previous version used `SELECT DISTINCT sale_id INTO v_sale_ids` which only
captures a single row into the array variable. This fix uses array_agg to
collect all affected sale_ids and iterate over them.
*/

CREATE OR REPLACE FUNCTION update_cost_price_by_sku_names(
  p_sku_names text[],
  p_cost_price numeric
) RETURNS void AS $$
DECLARE
  v_sale_ids uuid[];
  v_sale_id uuid;
BEGIN
  UPDATE sale_items
  SET cost_price = p_cost_price
  WHERE name = ANY(p_sku_names);

  -- Collect all distinct sale_ids that contain these items
  SELECT array_agg(DISTINCT sale_id) INTO v_sale_ids
  FROM sale_items WHERE name = ANY(p_sku_names);

  IF v_sale_ids IS NOT NULL THEN
    FOREACH v_sale_id IN ARRAY v_sale_ids LOOP
      PERFORM public.recompute_sale_profit(v_sale_id);
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_cost_price_by_sku_names(text[], numeric) TO anon, authenticated;
