-- P6: unique post views per authenticated viewer
-- Deduplicate existing rows (keep earliest)
DELETE FROM post_views a
USING post_views b
WHERE a.viewer_id IS NOT NULL
  AND b.viewer_id IS NOT NULL
  AND a.post_id = b.post_id
  AND a.viewer_id = b.viewer_id
  AND a.viewed_at > b.viewed_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_views_unique_viewer
  ON post_views (post_id, viewer_id)
  WHERE viewer_id IS NOT NULL;

-- Recompute view_count = unique authed viewers + anonymous rows
UPDATE posts p SET view_count = (
  SELECT COUNT(*)::int FROM (
    SELECT 1 FROM post_views pv WHERE pv.post_id = p.id AND pv.viewer_id IS NOT NULL
    UNION ALL
    SELECT 1 FROM post_views pv2 WHERE pv2.post_id = p.id AND pv2.viewer_id IS NULL
  ) t
);
