CREATE TABLE dashboard_operations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT
);
CREATE INDEX dashboard_operations_owner_time ON dashboard_operations(owner_id, created_at);
