# Set up Grafana

The dashboards live in Grafana Cloud. Grafana Cloud has no D1 data source, so each panel calls a query route of your Worker through the Infinity plugin.

You need:

- A Grafana Cloud account. The free plan is enough.
- The address of your Worker and its `QUERY_TOKEN` (see `docs/setup-cloudflare.md`).

Use the query token only. Never use the ingest token in Grafana.

## 1. Install the Infinity plugin

1. In Grafana Cloud, open **Connections** and then **Add new connection**.
2. Search for **Infinity** and install it.

## 2. Add the data source

You make one data source for all dashboards. Each panel sets the route of its metric in its own URL.

1. Add a new **Infinity** data source. Give it a name, for example `Devanalytics`.
2. **Authentication:** choose **Bearer token** and paste the `QUERY_TOKEN` of the Worker.
3. **Allowed hosts:** add the address of the Worker, for example `https://devanalytics.<your-subdomain>.workers.dev`. Infinity refuses a host that is not in this list.
4. **Cache (optional):** if the data source has a **Cache** tab, enable query caching with a time to live of 1 hour (`3600000` ms). Your data changes only when a commit is merged or a run ends, so a cache keeps the D1 reads low. Query caching is not on every Grafana Cloud plan. The free plan has no **Cache** tab. Without a cache, each view of a dashboard reads D1. This is fine for a private dashboard (see the read limit in `docs/setup-cloudflare.md`).
5. Select **Save & test**.

### Add the data source with the `gcx` CLI

You can make the same data source with the Grafana CLI. Save this manifest as `datasource.yaml`. The token comes from an environment variable, so it never goes into a file.

```yaml
apiVersion: yesoreyeram-infinity-datasource.datasource.grafana.app/v0alpha1
kind: DataSource
metadata:
  name: devanalytics
secure:
  bearerToken:
    fromEnv: DEVANALYTICS_QUERY_TOKEN
spec:
  type: yesoreyeram-infinity-datasource
  title: Devanalytics
  access: proxy
  url: https://devanalytics.<your-subdomain>.workers.dev
  jsonData:
    allowedHosts:
      - https://devanalytics.<your-subdomain>.workers.dev
    auth_method: bearerToken
    global_queries: []
    oauthPassThru: false
```

```
export DEVANALYTICS_QUERY_TOKEN="<QUERY_TOKEN>"
gcx datasources create -f datasource.yaml
gcx datasources health devanalytics
```

The `uid` of the data source is the `name` in the manifest, here `devanalytics`.

## 3. Import the dashboards

Each metric has its own dashboard: `metrics/<name>/dashboard.json`. Import the dashboards of the metrics that you use.

1. In Grafana, open **Dashboards**, then **New**, then **Import**.
2. Upload the file, for example `metrics/coverage/dashboard.json`.
3. Fill in the fields that Grafana shows:

   | Field | Value |
   |---|---|
   | **Devanalytics** | The Infinity data source from step 2. |
   | **Worker URL** | The address of the Worker, with no slash at the end. |
   | **Repository URL** | The address of your repository on GitHub, for example `https://github.com/owner/repository`. Only the `complexity`, `coverage` and `tests` dashboards have this field. The links to files and runs use it. |

4. Select **Import**.

Grafana writes the values into the dashboard when you import it, so you can use the dashboard with no more setup. To change a value later, import the file again with the new value. The `uid` of each dashboard stays the same, so Grafana asks if it can overwrite the old version.

### Import with the Grafana API

You can import all dashboards in one command. With the `gcx` CLI, use `gcx api` in place of `curl`: it uses your login. With `curl`, make a service account in Grafana with the role **Editor**, and make a token for it. Then run:

```
export GRAFANA_URL="https://<your-stack>.grafana.net"
export GRAFANA_TOKEN="<service account token>"
export DS_UID="<uid of the Infinity data source>"
export WORKER_URL="https://devanalytics.<your-subdomain>.workers.dev"
export REPO_URL="https://github.com/<owner>/<repository>"

for file in metrics/*/dashboard.json; do
  jq --arg ds "$DS_UID" --arg worker "$WORKER_URL" --arg repo "$REPO_URL" '{
    dashboard: .,
    overwrite: true,
    inputs: [.__inputs[] | {
      name, type, pluginId: (.pluginId // ""),
      value: (if .name == "DS_DEVANALYTICS" then $ds elif .name == "WORKER_URL" then $worker else $repo end)
    }]
  }' "$file" | curl -sS -X POST "$GRAFANA_URL/api/dashboards/import" \
    -H "Authorization: Bearer $GRAFANA_TOKEN" -H "Content-Type: application/json" --data @-
done
```

The uid of the data source is in the address of its settings page: `/connections/datasources/edit/<uid>`.

To put the dashboards in a folder, make the folder first (`gcx api /api/folders -d '{"uid":"devanalytics","title":"Devanalytics"}'`), and add `folderUid: "devanalytics"` next to `overwrite: true` in the `jq` program.

## The variables

| Variable | Dashboard | Meaning | Default |
|---|---|---|---|
| `folder` | `complexity`, `coverage` | The folder to show. The list has the folders of the newest snapshot. | `.`, the whole repository |
| `suite` | `coverage` | The coverage report to show. | `total` |
| `workflow` | `ci` | The workflow that the panels count. | The workflow with the most runs |
| `group` | `ci` | The log group of the panel "Log group time". | The group with the most total time |

The panels send the value of a variable as a bound parameter, `"params": ["$folder"]`. The value never goes into the SQL text.

## The time range

Each dashboard has the fixed range `now-1y/d` to `now/d`. The `/d` rounds both ends to the day.

On a plan with query caching, Grafana puts the time range in the key of its cache. A range such as "Last 1 year" changes at each load, so most views miss the cache and read D1 each time. A range that is rounded to the day gives the same key all day. If you change the range, use a rounded range or fixed dates.

The panels do not filter by time in their SQL. The range only chooses which part of the history the charts show. Make it longer if your history is longer than one year.

## Public dashboards

You can share a dashboard with a public link in Grafana. Do this only for a public repository, because a viewer sees all the data of the panels (see `docs/security.md`).

A public dashboard does not support template variables. Grafana sends the text `$folder` instead of a value. Each panel query handles this case: when a parameter is empty or starts with `$`, the query uses its default. The default is the folder `.`, the suite `total`, the workflow with the most runs, or the log group with the most total time.

On a public dashboard, the variables do not show, and the panels show their defaults.

## When a panel shows no data

| What you see | Cause and fix |
|---|---|
| `401` or "Unauthorized" | The bearer token of the data source is not the `QUERY_TOKEN`. Set it again. |
| "Host not allowed" | The address of the Worker is not in **Allowed hosts**. |
| `422` and a message about a missing table | You did not run `npm run migrate:remote`. |
| `400` and a message about a table | The panel names a table of another metric. Import the dashboard again. |
| No data, and no error | The Worker has no rows for this metric yet. Run the workflow, or run a backfill. |
| A time series panel with no data | The `date` column must have the type **Timestamp** in the query. The dashboards already set it. |
| Panels of the `coverage` dashboard for tests are empty | The `test-results` input of the Action is not set. |
