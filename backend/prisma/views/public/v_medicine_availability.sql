SELECT
  m.id AS medicine_id,
  m.code,
  m.name,
  fn_strength_label(m.id) AS strength_label,
  COALESCE(sum(fs.usable), (0) :: numeric) AS network_usable,
  count(*) FILTER (
    WHERE
      (fs.usable > 0)
  ) AS facilities_holding,
  min(fs.nearest_usable_expiry) AS nearest_expiry,
  (
    SELECT
      count(*) AS count
    FROM
      v_shortage_status ss
    WHERE
      (
        (ss.medicine_id = m.id)
        AND (ss.stock_status <> 'OK' :: text)
      )
  ) AS facilities_short
FROM
  (
    medicines m
    LEFT JOIN v_facility_stock fs ON ((fs.medicine_id = m.id))
  )
GROUP BY
  m.id;