# example

A test metric. It checks the core. It has no dashboard.

## Snapshot

| Field | Type | Meaning |
|---|---|---|
| `sha` | string | Commit sha. 40 or 64 hex characters. |
| `date` | string | Commit date in ISO 8601. |
| `items` | array | At most 1000 objects with `name` (string) and `value` (integer). |

## Tables

- `example_items`: one row for each item.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `file` | `example.json` | JSON file to read, relative to `working-directory`. When the file has no `sha` or `date`, they come from the commit that is checked out there. |

## Rows for each ingest

One row for each item.
