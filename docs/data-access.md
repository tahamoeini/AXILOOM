# Data access, caches, and verification

## Read paths

Issue filtering, count, and pagination are performed in SQLite. Detail views request issue activity and sprint membership on demand. Import and report work runs through workers. The renderer receives compact report and product-record projections rather than full issue histories for every page.

## Evidence and cache boundaries

Raw issue and sprint payloads, revisions, changelog pages, import provenance, conflicts, product records, and local relationship events are durable evidence. Semantic projections and report caches are rebuildable. Configuration revisions are persisted and included in report cache fingerprints. Product-record edits invalidate workspace views without forcing an unrelated Jira metric refresh.

Migrations are additive in the SQLite schema and retain existing records. The app includes database schema upgrades, profile normalization, profile import/export, workspace backup/restore, and a dry-run-first utility for copying and reconciling a closed legacy workspace into a new database. The copy utility does not merge data into an active workspace or contact Jira.

## Automated checks

`npm run test:configuration` checks profile normalization, validation, legacy review state, and configuration revision history. `npm run test:data-access` uses a small synthetic fixture to check issue projection filters, issue activity pagination, report/cache behavior, local relations, and schema upgrades. `npm run test:workspaces` checks that separate workspaces remain isolated, including duplicate provider identifiers.

These checks are useful regression evidence, not production parity. Synthetic 50 MB and 500 MB database benchmarks now record paged-query latency, snapshot time/size, memory, counts, and SQLite query plans; the 500 MB snapshot used about 1.36 GB RSS. This does not establish a production performance budget. There is no live Jira tenant, 1 GB snapshot run, full Electron E2E suite, or real legacy-database migration drill. See [`performance-benchmarks.md`](performance-benchmarks.md) and [`implementation-progress.md`](implementation-progress.md) for exact results and open gates.
