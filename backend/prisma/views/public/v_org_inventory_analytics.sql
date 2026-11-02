SELECT
  o.id AS organization_id,
  o.name,
  o.org_type,
  count(DISTINCT f.id) AS facilities,
  COALESCE(sum(fis.usable_units), (0) :: numeric) AS usable_units,
  COALESCE(sum(fis.usable_value), (0) :: numeric) AS usable_value,
  COALESCE(sum(fis.critical_shortages), (0) :: numeric) AS critical_shortages,
  COALESCE(sum(fis.expiring_30d_batches), (0) :: numeric) AS expiring_30d_batches,
  (
    SELECT
      COALESCE(
        sum(((mv.quantity) :: numeric * b.unit_cost)),
        (0) :: numeric
      ) AS "coalesce"
    FROM
      (
        (
          (
            inventory_movements mv
            JOIN inventory i ON ((i.id = mv.inventory_id))
          )
          JOIN facilities f2 ON ((f2.id = i.facility_id))
        )
        JOIN medicine_batches b ON ((b.id = i.batch_id))
      )
    WHERE
      (
        (f2.organization_id = o.id)
        AND (
          mv.movement_type = ANY (
            ARRAY ['EXPIRY_WRITE_OFF'::text, 'DISPOSAL'::text, 'DAMAGE'::text, 'TRANSIT_DAMAGE'::text]
          )
        )
      )
  ) AS wastage_value_estimate,
  (
    SELECT
      round(
        avg(
          ((t.status = 'RECEIVED' :: transfer_status)) :: integer
        ),
        3
      ) AS round
    FROM
      (
        transfer_requests t
        JOIN facilities f3 ON ((f3.id = t.source_facility_id))
      )
    WHERE
      (
        (f3.organization_id = o.id)
        AND (
          t.status = ANY (
            ARRAY ['RECEIVED'::transfer_status, 'REJECTED'::transfer_status, 'CANCELLED'::transfer_status]
          )
        )
      )
  ) AS transfer_completion_rate
FROM
  (
    (
      organizations o
      LEFT JOIN facilities f ON ((f.organization_id = o.id))
    )
    LEFT JOIN v_facility_inventory_summary fis ON ((fis.facility_id = f.id))
  )
GROUP BY
  o.id;