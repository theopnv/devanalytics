CREATE TABLE example_items (
  sha TEXT NOT NULL CHECK (length(sha) IN (40, 64)),
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (sha, name)
) WITHOUT ROWID;
