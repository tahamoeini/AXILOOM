# Backup, restore, and migration review

## Implemented behavior

- A workspace backup is created through SQLite `VACUUM INTO`, checked with `PRAGMA integrity_check`, and stripped of the saved Jira token. The destination is written through a temporary file and replacement rollback path.
- Restore accepts a local SQLite workspace file, checks its SQLite header, required tables, and integrity before touching the active database, then preserves the current database under a pre-restore name before switching.
- Workspace switching is blocked while imports, synchronization, reads, reports, and backup/restore maintenance are active.
- Profile import validates a normalized profile before applying it. Profile files contain no credentials. Legacy profiles are marked for review and retain their source JSON in configuration revision history.
- SQLite schema upgrades are additive and preserve raw issue/sprint evidence, product records, and relationship history.
- `tools/migrate-workspace.mjs` byte-copies a closed workspace and any SQLite sidecars into staging, checks source hashes before and after the copy, applies migrations only to staging, reconciles protected evidence/counts and writes a sidecar manifest. Existing destinations are refused.

## Evidence and limits

`npm run test:migration` passes against a synthetic schema-version-1 workspace and verifies dry-run cleanup, raw issue/sprint payload retention, product-record/event reconciliation, source immutability, and no-overwrite behavior. Backup, restore, interrupted replacement, corrupted backup, and real user-data recovery have not been exercised. `npm run test:workspaces` verifies separation between synthetic workspace databases; it is not a backup/restore drill. No user-owned legacy database was provided, so counts, relationships, and historical metric parity cannot be reconciled against a real workspace.

The migration command keeps the source file and refuses to overwrite the destination. Review the dry-run report and retain the migration manifest. A real-data migration and restore drill remain release gates; do not treat a synthetic migration pass as acceptance for a user's database.
