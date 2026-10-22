# Workspace migration

`tools/migrate-workspace.mjs` copies a closed historical SQLite workspace into a new Axiloom workspace file and applies the current additive schema/configuration migrations to the copy. It never opens the original file through the application migration path and never overwrites an existing destination.

## Dry run

Close the source application first. Choose a destination filename in a directory that already exists, then run:

```powershell
node tools/migrate-workspace.mjs --source "C:\path\to\workspace.sqlite" --destination "C:\path\to\axiloom-workspace.sqlite" --dry-run
```

The command copies the database and any SQLite sidecar files to temporary staging files beside the destination, checks their hashes before and after copying, runs the migrations and reconciliation checks, prints a JSON report, and removes the temporary files. It does not create the destination or its manifest.

## Create the migrated copy

After reviewing the dry-run report, repeat the command without `--dry-run`:

```powershell
node tools/migrate-workspace.mjs --source "C:\path\to\workspace.sqlite" --destination "C:\path\to\axiloom-workspace.sqlite"
```

The source remains in place. The command writes a new SQLite file and a sibling `axiloom-workspace.sqlite.migration.json` manifest. Keep both with the migration record. Destination files are never replaced; choose a new destination if either output already exists.

## Validation performed

- Source and migrated copies pass SQLite integrity and foreign-key checks.
- The source schema must not be newer than the migration tool and must contain workspace tables.
- Configuration revision history, deletion tombstones, issue/sprint evidence, product records, history rows, and non-configuration settings are reconciled by stable identity and content.
- Jira issue and sprint rows are reconciled; when an issue's current representation changes as part of a legacy history migration, its original raw JSON must remain as an issue revision.
- Protected workspace table counts may grow during additive migrations, but may not decrease.
- The source database and any WAL, shared-memory, or rollback-journal sidecars are byte-hashed before and after copying. A detected change aborts the migration. SQLite validation and all schema changes run against staging copies.
- The manifest records schema versions, hashes, row counts, and reconciliation totals. It contains no issue payloads or credential values.

The migrated profile can carry a `review-required` or `unconfigured` status. Review project roles, source identity, fields, teams, workflows, and calendar settings before enabling analytics. Migration does not contact Jira or merge the result into an existing workspace.

## Evidence and limits

`npm run test:migration` exercises dry-run cleanup, old schema migration, raw issue/sprint payload preservation, product-record and event reconciliation, source-file immutability, and refusal to overwrite an existing destination on synthetic SQLite data. No user-owned workspace was available for migration or recovery testing. Run the dry run on an authorized copy of a real workspace and inspect its reconciliation report before using the migrated copy.
