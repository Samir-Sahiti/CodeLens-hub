COMMIT;
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'untested_critical_file';

ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS has_test_coverage BOOLEAN DEFAULT FALSE;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS is_test_file BOOLEAN DEFAULT FALSE;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS coverage_percentage FLOAT;
ALTER TABLE graph_nodes DROP CONSTRAINT IF EXISTS graph_nodes_coverage_percentage_bounds;
ALTER TABLE graph_nodes ADD CONSTRAINT graph_nodes_coverage_percentage_bounds
  CHECK (coverage_percentage IS NULL OR (coverage_percentage >= 0 AND coverage_percentage <= 100));

ALTER TABLE repositories ADD COLUMN IF NOT EXISTS has_coverage_files BOOLEAN NOT NULL DEFAULT false;
