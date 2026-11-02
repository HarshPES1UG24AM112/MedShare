SELECT
  t.id,
  t.code,
  t.status,
  t.source_facility_id,
  s.name AS source_name,
  t.destination_facility_id,
  d.name AS destination_name,
  (s.organization_id <> d.organization_id) AS cross_organization,
  t.requested_by,
  u.full_name AS requested_by_name,
  t.created_at,
  (fn_now() - t.created_at) AS age,
  (
    SELECT
      count(*) AS count
    FROM
      transfer_items ti
    WHERE
      (ti.transfer_id = t.id)
  ) AS item_count,
  (
    SELECT
      sum(ti.quantity) AS sum
    FROM
      transfer_items ti
    WHERE
      (ti.transfer_id = t.id)
  ) AS total_units,
  ARRAY(
    SELECT
      st.st
    FROM
      unnest(
        CASE
          WHEN (s.organization_id <> d.organization_id) THEN ARRAY ['SOURCE_FACILITY'::approval_stage, 'SOURCE_ORGANIZATION'::approval_stage]
          ELSE ARRAY ['SOURCE_FACILITY'::approval_stage]
        END
      ) st(st)
    WHERE
      (
        NOT (
          EXISTS (
            SELECT
              1
            FROM
              transfer_approvals a
            WHERE
              (
                (a.transfer_id = t.id)
                AND (a.stage = st.st)
              )
          )
        )
      )
  ) AS missing_stages
FROM
  (
    (
      (
        transfer_requests t
        JOIN facilities s ON ((s.id = t.source_facility_id))
      )
      JOIN facilities d ON ((d.id = t.destination_facility_id))
    )
    JOIN users u ON ((u.id = t.requested_by))
  )
WHERE
  (
    t.status = ANY (
      ARRAY ['PENDING'::transfer_status, 'APPROVED'::transfer_status]
    )
  );