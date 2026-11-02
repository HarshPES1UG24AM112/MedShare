WITH RECURSIVE tree AS (
  SELECT
    regions.id,
    regions.parent_id,
    regions.code,
    regions.name,
    1 AS depth,
    regions.name AS path,
    regions.id AS state_id
  FROM
    regions
  WHERE
    (regions.parent_id IS NULL)
  UNION
  ALL
  SELECT
    r.id,
    r.parent_id,
    r.code,
    r.name,
    (t.depth + 1),
    ((t.path || ' › ' :: text) || r.name),
    t.state_id
  FROM
    (
      regions r
      JOIN tree t ON ((r.parent_id = t.id))
    )
)
SELECT
  id,
  parent_id,
  code,
  name,
  depth,
  (
    ARRAY ['STATE'::text, 'DISTRICT'::text, 'TALUK'::text]
  ) [depth] AS LEVEL,
  path,
  state_id
FROM
  tree;