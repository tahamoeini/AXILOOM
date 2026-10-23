# Axiloom — From Decisions to Delivery

Axiloom is a local-first product intelligence and delivery workspace. It combines Jira evidence, configurable delivery analytics, and locally maintained product records in an isolated workspace. Project keys, teams, semantic fields, workflow states, calendars, and display preferences belong to the workspace profile.

## Current support

- Offline JSON import for Jira issue and sprint pages, single issues, metadata, and calendar files.
- Jira Server/Data Center connection using HTTPS and a personal access token. The current environment has not been tested against a live tenant; verify the provider, permissions, and instance policy before relying on synchronization or writes.
- Jira Cloud OAuth is not implemented or claimed.
- Local SQLite workspaces, profile import/export, workspace backup and restore, delivery and product records, and XLSX/PDF export.

Synchronization reads evidence. Creating or changing Jira issues, comments, links, or attachments is a separate user-initiated action guarded by Jira metadata, permissions, review, and current-version checks. A network failure during a write can leave the remote outcome unknown; refresh Jira before retrying.

## Run and build

Install the locked dependencies and build the renderer:

```powershell
npm ci
npm run build
```

The desktop packaging scripts use verified official Electron runtime archives. See [`docs/release-verification.md`](docs/release-verification.md) for supported artifacts and package checks. Do not treat a renderer build as a packaged desktop release.

For an existing portable build, unpack the release archive and launch `Axiloom.exe`. A writable portable folder stores its workspace locally; otherwise Axiloom uses the current user's application data directory. Workspaces are local to one installation and should not be shared over a network drive.

## First workspace

On first launch, create or select a workspace and configure its profile before enabling reports:

1. Choose the locale and time zone.
2. Connect a supported Jira Server/Data Center instance or import JSON.
3. Discover projects, boards, issue types, statuses, and fields.
4. Assign projects to logical roles; map semantic Jira fields and teams.
5. Configure workflow completion, commitment states, milestones, and the working calendar.
6. Validate the profile, then import or synchronize source evidence.

Each workspace is bound to one Jira source. Offline JSON imports ask you to confirm the source name; import only files from that Jira instance, and create a separate workspace for another source. A source with imported evidence cannot be rebound. If an older offline workspace has no source ID, its first import asks you to attest the existing evidence to the named source.

Unmapped or ambiguous values remain visible in data quality. Axiloom does not infer links from title similarity. Jira Epic relationships, Jira issue links, and local product-record relationships remain distinct.

## Product records and reporting

The product workspace supports objectives, requests, decisions, meetings, actions, outcomes, and stakeholder records. Records retain their local history and can reference explicit Jira issue keys and other product records. Jira mutations happen only after a separate confirmation; local record changes do not silently create remote issues.

Delivery reports cover sprint scope and completion, estimates, flow, carryover, time-data coverage, capacity, and forecasting where configured evidence is available. Ratios with missing denominators stay blank. Story points and hours remain separate units. Time reconstructed from `timespent` changelog deltas is a proxy, not a Jira worklog. Person metrics are flow diagnostics, not performance rankings.

## Data and security

Raw Jira JSON and imported history are retained as evidence; normalized projections and report caches are rebuildable. Profile files exclude credentials. Workspace backups are verified before restore, and restore keeps a recoverable pre-restore database. Jira URLs require HTTPS and are checked against the configured host/network policy. Credentials are protected through the operating system's local credential protection when saved.

Use the dry-run-first [`workspace migration guide`](docs/workspace-migration.md) before moving a legacy SQLite workspace. Migration writes a new database and leaves its source in place.

The application includes a local Vazirmatn font. Date, time, and number formatting use the active profile locale and time zone. The current interface remains primarily Persian with mixed English terminology; complete English translation and accessibility review are still open release work.

## Developer checks

Run `npm run verify` for all eight regression suites followed by the production renderer build. GitHub verification runs on `main` pushes and pull requests; Windows release packaging also runs the complete regression suite.

After building the portable app, set `AXILOOM_SMOKE_ELECTRON` to a raw Electron executable and run `npm run test:native`. This creates disposable synthetic workspaces under `.test-tmp` and checks real preload/IPC, record persistence, workspace isolation, XLSX/PDF generation, and backup/restore recovery. Dialog selections and restart calls are intercepted; actual dialog interaction and process relaunch are separate acceptance checks. Windows release CI runs this test before publication.

```powershell
npm run test:configuration
npm run test:data-access
npm run test:workspaces
npm run test:migration
npm run build
```

These checks cover configuration normalization and revision history, SQLite data access and report/cache behavior, workspace isolation, and synthetic migration reconciliation. The renderer-only fixture at `/tools/renderer-harness.html` uses an in-memory bridge and does not verify Electron IPC or persistence. The checks do not establish live Jira compatibility, migration of a user-owned database, full UI accessibility, large-workspace performance, or a release package. See [`docs/implementation-progress.md`](docs/implementation-progress.md) for the current gate record.
