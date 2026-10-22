# Large-workspace benchmark evidence

**Updated:** 2026-10-22  
**Status:** Measured synthetic workloads; no production-size acceptance threshold has been defined.

## Method

Run `node --expose-gc tools/benchmark-large-workspace.mjs --target-mb=50` or `--target-mb=500` from the repository root. The script creates a disposable SQLite workspace under the system temporary directory, inserts deterministic synthetic Jira rows and product records, measures 40 indexed page reads, builds one analytics snapshot, checks row-count correctness and index plans, checkpoints the database, prints JSON measurements, then removes only its uniquely named temporary folder. `--skip-snapshot` measures the SQL paging path without building the analytics snapshot. The script accepts sizes from 1 MB through 1 GB; the 1 GB run was not performed.

`Issue page` and `record page` p50/p95 are measured over SQLite list-function calls in one Node process, including their SQL count and row projection work. `snapshot response` is serialized JSON size after `buildSnapshot`; it is not an Electron IPC or browser transfer measurement. RSS and V8 heap are sampled in the same process. Each fixture contains issue descriptions sized to approximate the requested source-payload total, so the numbers describe this deterministic test shape rather than all Jira histories.

## Results

| Fixture | Issues / product records | SQLite file | Issue page p50 / p95 | Record page p50 / p95 | Snapshot time | Snapshot JSON | Peak observed RSS / heap |
|---|---:|---:|---:|---:|---:|---:|---:|
| 50 MB | 6,400 / 640 | 54,759,424 bytes | 70.94 / 151.66 ms | 2.77 / 3.86 ms | 1,178.24 ms | 2,275 bytes | 219,492,352 / 140,221,664 bytes |
| 500 MB | 64,000 / 6,400 | 545,136,640 bytes | 98.06 / 150.53 ms | 10.92 / 14.81 ms | 11,894.20 ms | 2,291 bytes | 1,361,117,184 / 1,240,936,848 bytes |

Both runs returned exact issue and active-record counts. `EXPLAIN QUERY PLAN` used `idx_jira_issues_project_key` for issue pages and `idx_product_records_active_page` for record pages. Source JSON payloads totaled 49,558,279 bytes and 495,774,682 bytes respectively.

## Interpretation and limits

The interactive snapshot no longer carries full Jira issue rows or product record rows. It carries the active product-record count and up to five recent product-link previews. Product registers, record histories, editor references, and per-page delivery summaries use bounded SQL-backed requests. Record event history is capped at ten events per returned record.

Snapshot construction still loads and normalizes all Jira issues in the analytics worker. The fixtures store current Jira issue payloads directly; they do not reproduce revision-table duplication or large multi-page changelog histories. The 500 MB fixture used about 1.36 GB RSS and took about 11.9 seconds to build its snapshot. This is a material memory cost; no user-facing latency or memory budget has been approved, and 1 GB snapshot behavior is unknown. Record relationship histories remain part of the global snapshot, and product-record export still assembles its selected rows in the renderer. Electron IPC, native UI, cancellation/progress, live tenant data, real-workspace backup/restore, large changelog fixtures, and a full 1 GB run are not covered by these numbers.
