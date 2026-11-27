-- Rows written by this Worker for each UTC day. WITHOUT ROWID keeps one write for each update.
CREATE TABLE usage (
  day TEXT PRIMARY KEY,
  rows_written INTEGER NOT NULL CHECK (rows_written >= 0)
) WITHOUT ROWID;
