SELECT
  s.facility_id,
  f.code AS facility_code,
  f.name AS facility_name,
  f.organization_id,
  s.medicine_id,
  m.code AS medicine_code,
  m.name AS medicine_name,
  COALESCE(fs.usable, (0) :: bigint) AS usable,
  s.min_stock_level,
  s.reorder_threshold,
  s.safety_stock,
  d.daily_rate,
  d.demand_basis,
  CASE
    WHEN (d.daily_rate > (0) :: numeric) THEN round(
      (
        (COALESCE(fs.usable, (0) :: bigint)) :: numeric / d.daily_rate
      ),
      1
    )
    ELSE NULL :: numeric
  END AS days_of_inventory,
  CASE
    WHEN (
      COALESCE(fs.usable, (0) :: bigint) < s.min_stock_level
    ) THEN 'CRITICAL' :: text
    WHEN (
      COALESCE(fs.usable, (0) :: bigint) < s.reorder_threshold
    ) THEN 'LOW' :: text
    ELSE 'OK' :: text
  END AS stock_status
FROM
  (
    (
      (
        (
          facility_medicine_settings s
          JOIN facilities f ON ((f.id = s.facility_id))
        )
        JOIN medicines m ON ((m.id = s.medicine_id))
      )
      JOIN v_demand d ON (
        (
          (d.facility_id = s.facility_id)
          AND (d.medicine_id = s.medicine_id)
        )
      )
    )
    LEFT JOIN v_facility_stock fs ON (
      (
        (fs.facility_id = s.facility_id)
        AND (fs.medicine_id = s.medicine_id)
      )
    )
  );