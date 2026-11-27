# Release

This page is for the owner of the template. It shows how to publish a version and how to test it before you move the major tag.

## Version tags

The examples and the guides pin the Action to a full tag, for example `theopnv/devanalytics/action@v0.0.1`. The Action runs from `action/dist/index.js`, so the tag must point to a commit where `npm run build:action` leaves no diff.

1. Make sure that `main` is green in CI.
2. Create and push the tag:

   ```
   git switch main
   git pull --ff-only
   git tag -a v0.0.1 -m "v0.0.1"
   git push origin v0.0.1
   ```

3. Create a GitHub release for the tag.

To publish `v1` later, run the checks below on the new tag. Then replace `action@v0.0.1` with `action@v1` in `examples/`, `metrics/*/README.md` and `examples/metrics/`, tag `v1.0.0`, and move `v1`:

```
git tag -fa v1 -m "v1" v1.0.0
git push origin v1 --force
```

## Test a release

Use a Cloudflare account and a GitHub repository that you can delete.

1. **Deploy button.** Open the "Deploy to Cloudflare" button of `README.md` on the tag. Check that the Worker and the D1 database exist.
2. **Tables and secrets.** Run `npm run migrate:remote`, then set `INGEST_TOKEN` and `QUERY_TOKEN` with `npx wrangler secret put`.
3. **Usage.** Run `curl -H "Authorization: Bearer <QUERY_TOKEN>" <worker-url>/v1/usage`. The answer shows `rowsWritten: 0`.
4. **Example workflows.** In a public throwaway repository, copy `examples/workflows/commit.yml` and `examples/workflows/runs.yml`. Set the secret `DEVANALYTICS_INGEST_TOKEN` and the variable `DEVANALYTICS_URL`. Push a commit to the default branch and run your test workflow. Check that all four jobs pass, and that `/v1/usage` shows rows.
5. **Backfill.** From your fork, run `npm run backfill -- --metric complexity --repo <path> --tags --dry-run`. Then run it without `--dry-run`. Check `/v1/usage` again, and run the command a second time. The second run must upload nothing.
6. **Badge.** Open `<worker-url>/v1/coverage/badge` and add the shields.io badge from `README.md` to the throwaway repository. Check that it shows a number.
7. **Clean up.** Delete the Worker, the database and the throwaway repository.
