WITH RECURSIVE tree AS (
  SELECT
    medicine_categories.id,
    medicine_categories.parent_id,
    medicine_categories.name,
    1 AS depth,
    medicine_categories.name AS path,
    medicine_categories.id AS root_id
  FROM
    medicine_categories
  WHERE
    (medicine_categories.parent_id IS NULL)
  UNION
  ALL
  SELECT
    c.id,
    c.parent_id,
    c.name,
    (t.depth + 1),
    ((t.path || ' › ' :: text) || c.name),
    t.root_id
  FROM
    (
      medicine_categories c
      JOIN tree t ON ((c.parent_id = t.id))
    )
)
SELECT
  id,
  parent_id,
  name,
  depth,
  path,
  root_id
FROM
  tree;