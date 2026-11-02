WITH d AS (
  SELECT
    s.facility_id,
    s.medicine_id,
    s.estimated_daily_consumption,
    s.estimate_is_simulated,
    h.first_dispense_date,
    COALESCE(h.units_in_window, (0) :: bigint) AS units_in_window,
    e.measured_demand_min_history_days AS window_days,
    CASE
      WHEN (
        (
          h.first_dispense_date <= (fn_today() - e.measured_demand_min_history_days)
        )
        AND (COALESCE(h.units_in_window, (0) :: bigint) > 0)
      ) THEN round(
        (
          (h.units_in_window) :: numeric / (e.measured_demand_min_history_days) :: numeric
        ),
        2
      )
      ELSE NULL :: numeric
    END AS measured_daily_consumption,
    (
      (
        h.first_dispense_date <= (fn_today() - e.measured_demand_min_history_days)
      )
      AND (COALESCE(h.units_in_window, (0) :: bigint) = 0)
    ) AS possibly_censored
  FROM
    (
      (
        facility_medicine_settings s
        CROSS JOIN engine_config e
      )
      LEFT JOIN LATERAL (
        SELECT
          (min(mv.created_at)) :: date AS first_dispense_date,
          sum(mv.quantity) FILTER (
            WHERE
              (
                mv.created_at >= (fn_today() - e.measured_demand_min_history_days)
              )
          ) AS units_in_window
        FROM
          (
            (
              inventory_movements mv
              JOIN inventory i ON ((i.id = mv.inventory_id))
            )
            JOIN medicine_batches b ON ((b.id = i.batch_id))
          )
        WHERE
          (
            (mv.movement_type = 'DISPENSE' :: text)
            AND (i.facility_id = s.facility_id)
            AND (b.medicine_id = s.medicine_id)
          )
      ) h ON (TRUE)
    )
)
SELECT
  facility_id,
  medicine_id,
  estimated_daily_consumption,
  estimate_is_simulated,
  first_dispense_date,
  units_in_window,
  window_days,
  measured_daily_consumption,
  COALESCE(possibly_censored, false) AS possibly_censored,
  COALESCE(
    measured_daily_consumption,
    estimated_daily_consumption
  ) AS daily_rate,
  CASE
    WHEN (measured_daily_consumption IS NOT NULL) THEN 'MEASURED' :: text
    WHEN estimate_is_simulated THEN 'ESTIMATED_SIMULATED' :: text
    ELSE 'ESTIMATED_CONFIGURED' :: text
  END AS demand_basis
FROM
  d;