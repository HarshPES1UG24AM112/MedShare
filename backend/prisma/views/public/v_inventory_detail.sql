SELECT
  i.id AS inventory_id,
  i.facility_id,
  f.code AS facility_code,
  f.name AS facility_name,
  f.organization_id,
  b.id AS batch_id,
  b.batch_number,
  b.medicine_id,
  m.code AS medicine_code,
  m.name AS medicine_name,
  mf.name AS manufacturer,
  b.manufacture_date,
  b.expiry_date,
  b.unit_cost,
  b.status AS batch_status,
  i.qty_available,
  i.qty_reserved,
  i.qty_damaged,
  i.updated_at,
  (b.expiry_date - fn_today()) AS days_to_expiry,
  CASE
    WHEN (b.expiry_date < fn_today()) THEN 'EXPIRED' :: text
    WHEN (b.expiry_date <= (fn_today() + 7)) THEN 'WITHIN_7_DAYS' :: text
    WHEN (b.expiry_date <= (fn_today() + 30)) THEN 'WITHIN_30_DAYS' :: text
    WHEN (b.expiry_date <= (fn_today() + 60)) THEN 'WITHIN_60_DAYS' :: text
    ELSE 'HEALTHY' :: text
  END AS expiry_bucket,
  (
    (b.status = 'ACTIVE' :: batch_status)
    AND (b.expiry_date >= fn_today())
  ) AS is_usable,
  round(((i.qty_available) :: numeric * b.unit_cost), 2) AS available_value
FROM
  (
    (
      (
        (
          inventory i
          JOIN medicine_batches b ON ((b.id = i.batch_id))
        )
        JOIN medicines m ON ((m.id = b.medicine_id))
      )
      JOIN manufacturers mf ON ((mf.id = b.manufacturer_id))
    )
    JOIN facilities f ON ((f.id = i.facility_id))
  );