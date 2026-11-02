SELECT
  f.id AS facility_id,
  f.code,
  f.name,
  f.facility_type,
  f.organization_id,
  o.name AS organization_name,
  rt.path AS region_path,
  COALESCE(
    sum(d.qty_available) FILTER (
      WHERE
        d.is_usable
    ),
    (0) :: bigint
  ) AS usable_units,
  COALESCE(sum(d.qty_reserved), (0) :: bigint) AS reserved_units,
  COALESCE(sum(d.qty_damaged), (0) :: bigint) AS damaged_units,
  COALESCE(
    sum(d.available_value) FILTER (
      WHERE
        d.is_usable
    ),
    (0) :: numeric
  ) AS usable_value,
  count(DISTINCT d.medicine_id) FILTER (
    WHERE
      (d.qty_available > 0)
  ) AS medicines_in_stock,
  count(*) FILTER (
    WHERE
      ((d.qty_available + d.qty_reserved) > 0)
  ) AS batches_on_hand,
  count(*) FILTER (
    WHERE
      (
        (d.expiry_bucket = 'EXPIRED' :: text)
        AND (d.qty_available > 0)
      )
  ) AS expired_batches,
  count(*) FILTER (
    WHERE
      (
        (
          d.expiry_bucket = ANY (
            ARRAY ['WITHIN_7_DAYS'::text, 'WITHIN_30_DAYS'::text]
          )
        )
        AND (d.qty_available > 0)
      )
  ) AS expiring_30d_batches,
  (
    SELECT
      count(*) AS count
    FROM
      v_shortage_status ss
    WHERE
      (
        (ss.facility_id = f.id)
        AND (ss.stock_status = 'CRITICAL' :: text)
      )
  ) AS critical_shortages,
  (
    SELECT
      count(*) AS count
    FROM
      v_shortage_status ss
    WHERE
      (
        (ss.facility_id = f.id)
        AND (ss.stock_status = 'LOW' :: text)
      )
  ) AS low_stock
FROM
  (
    (
      (
        facilities f
        JOIN organizations o ON ((o.id = f.organization_id))
      )
      JOIN v_region_tree rt ON ((rt.id = f.region_id))
    )
    LEFT JOIN v_inventory_detail d ON ((d.facility_id = f.id))
  )
GROUP BY
  f.id,
  o.name,
  rt.path;