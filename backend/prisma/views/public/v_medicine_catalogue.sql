SELECT
  m.id,
  m.code,
  m.name,
  fn_strength_label(m.id) AS strength_label,
  (
    (m.name || ' ' :: text) || COALESCE(fn_strength_label(m.id), '' :: text)
  ) AS display_name,
  m.dosage_form,
  m.unit_volume_ml,
  u.name AS unit,
  m.category_id,
  ct.path AS category_path,
  ct.name AS category,
  m.requires_cold_chain,
  m.is_essential,
  m.is_active,
  m.description,
  (
    SELECT
      string_agg(
        s.name,
        ', ' :: text
        ORDER BY
          s.name
      ) AS string_agg
    FROM
      (
        medicine_ingredients i
        JOIN substances s ON ((s.id = i.substance_id))
      )
    WHERE
      (i.medicine_id = m.id)
  ) AS substances,
  m.created_at,
  m.updated_at
FROM
  (
    (
      medicines m
      JOIN medicine_units u ON ((u.id = m.dispensing_unit_id))
    )
    JOIN v_category_tree ct ON ((ct.id = m.category_id))
  );