# Backup, restore, and migration review

## Implemented behavior

- A workspace backup is created through SQLite `VACUUM INTO`, checked with `PRAGMA integrity_check`, and stripped of the saved Jira token. The destination is written through a temporary file and replacement rollback path.
- Restore accepts a local SQLite workspace file, checks its SQLite header, required tables, and integrity before touching the active database, then preserves the current database under a pre-restore name before switching.
- Workspace switching is blocked while imports, synchronization, reads, reports, and backup/restore maintenance are active.
- Profile import validates a normalized profile before applying it. Profile files contain no credentials. Legacy profiles are marked for review and retain their source JSON in configuration revision history.
- SQLite schema upgrades are additive and preserve raw issue/sprint evidence, product records, and relationship history.

## Evidence and limits

Backup, restore, interrupted replacement, corrupted backup, and real user-data recovery have not been exercised in this mission. `npm run test:workspaces` verifies separation between synthetic workspace databases; it is not a backup/restore drill. No user-owned legacy database was provided, so data counts, hashes, relationships, and historical metric parity cannot be reconciled against a real migration.

The app still needs a dedicated legacy workspace migration command with dry-run output, backup confirmation, transactional copy, and post-migration count/hash reconciliation. Until that work and recovery drills pass, the backup code should be considered implemented but not release-accepted.
