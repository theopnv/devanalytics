-- One row for each file of the build output in each commit.
CREATE TABLE bundlesize_files (
  sha TEXT NOT NULL CHECK (length(sha) IN (40, 64)),
  date TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (typeof(bytes) = 'integer' AND bytes >= 0),
  gzip_bytes INTEGER NOT NULL CHECK (typeof(gzip_bytes) = 'integer' AND gzip_bytes >= 0),
  PRIMARY KEY (sha, path)
) WITHOUT ROWID;

CREATE INDEX bundlesize_files_path_date ON bundlesize_files (path, date);
