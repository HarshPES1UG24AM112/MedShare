SELECT
  facility_id,
  medicine_id,
  sum(qty_available) FILTER (
    WHERE
      is_usable
  ) AS usable,
  sum(qty_reserved) AS reserved,
  sum(qty_damaged) AS damaged,
  sum(qty_available) FILTER (
    WHERE
      (expiry_bucket = 'EXPIRED' :: text)
  ) AS expired_on_hand,
  sum(qty_available) FILTER (
    WHERE
      (batch_status <> 'ACTIVE' :: batch_status)
  ) AS blocked_on_hand,
  count(*) FILTER (
    WHERE
      ((qty_available + qty_reserved) > 0)
  ) AS batches_on_hand,
  min(expiry_date) FILTER (
    WHERE
      (
        is_usable
        AND (qty_available > 0)
      )
  ) AS nearest_usable_expiry
FROM
  v_inventory_detail
GROUP BY
  facility_id,
  medicine_id;