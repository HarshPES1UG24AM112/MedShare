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
  COALESCE(sh.n, (0) :: bigint) AS facilities_short
FROM
  (
    (
      medicines m
      LEFT JOIN v_facility_stock fs ON ((fs.medicine_id = m.id))
    )
    LEFT JOIN (
      SELECT
        v_shortage_status.medicine_id,
        count(*) AS n
      FROM
        v_shortage_status
      WHERE
        (v_shortage_status.stock_status <> 'OK' :: text)
      GROUP BY
        v_shortage_status.medicine_id
    ) sh ON ((sh.medicine_id = m.id))
  )
GROUP BY
  m.id,
  sh.n;