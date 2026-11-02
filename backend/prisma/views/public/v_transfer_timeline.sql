SELECT
  h.transfer_id,
  t.code,
  h.id AS event_id,
  lag(h.to_status) OVER w AS from_status,
  h.to_status,
  h.changed_by,
  u.full_name AS changed_by_name,
  h.note,
  h.changed_at,
  (lead(h.changed_at) OVER w - h.changed_at) AS time_in_state,
  row_number() OVER w AS step
FROM
  (
    (
      transfer_status_history h
      JOIN transfer_requests t ON ((t.id = h.transfer_id))
    )
    JOIN users u ON ((u.id = h.changed_by))
  ) WINDOW w AS (
    PARTITION BY h.transfer_id
    ORDER BY
      h.changed_at,
      h.id
  );