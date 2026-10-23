# Verification continuation — 2026-10-23

Code baseline: `082478311c13912d08c8e1fc93a9abc923e3d31f`.

- All eight focused npm suites passed: configuration, providers, data-access, semantic-mappings, reporting, setup, workspaces, migration. TEMP/TMP were scoped inside the checkout. Filesystem hardlink/junction integration branches reported EPERM and remain unverified.
- Production renderer build passed: TypeScript and Vite, 1,763 modules. The locked Rollup Windows optional package was restored through npm without tracked manifest changes.
- In-app browser confirmed the synthetic Epic report summary and pagination: 55 children, first page 1–50, second page 51–55. The issue-detail fixture lacks getIssueDetails; this path does not establish Electron behavior.
- Official Electron 45.0.0 Windows x64 archive downloaded from the Electron GitHub release. SHA-256 matched its official SHASUMS256.txt: `ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`.
- Portable packaging reached its final staged-directory rename, then failed with EPERM. No completed release archive or fresh-install verification is claimed. Staging is retained under release/.
- Independent review identified that the sync worker cancellation listener could retain its message port after a terminal result. The follow-up closes the port after posting done/error/cancelled. Syntax/diff checks passed; runtime regression verification remains required.
- Removed temporary provider error logging that could print transport errors.
- GitHub API confirmed public repository tahamoeini/AXILOOM, default branch codex/axiloom-transformation, no main/master branch and no open PR. User authorized merge after completion; final acceptance gates remain open, so no merge occurred.

Release remains unready. This record supplements the earlier progress documents; their older commit/publication statements are historical and need consolidation before delivery.

## Repository review follow-up

This section supersedes earlier branch and package availability statements above and in the implementation progress and risk register.

- Fetched origin successfully. Local main and origin/main started at d99ff3a; the old transformation branch points at the same baseline. No history rewrite is required.
- Fixed the Windows release trigger from master to main and included shared/schema changes in its path filters. Release packaging now runs all eight suites rather than only data access.
- Added npm test (all eight suites), npm run verify (tests plus production build), and a read-only verification workflow for main pushes and pull requests.
- Re-ran all eight suites successfully. Hardlink, junction, and symlink integration branches still report EPERM and are not counted as verified.
- Production TypeScript/Vite build passed outside the filesystem sandbox; the sandbox still rejects Vite realpath on index.html.
- Windows portable packaging passed using the cached official Electron 45.0.0 archive. Inspected all 160 ZIP entries: executable, main entry, and renderer index are present; no workspace directory or SQLite file is included.
- ZIP SHA-256: 3761e00237388b83d1431e42ad4301f65fff6123ed91918d4b01002df718807a. Artifact: release/Axiloom-Portable.zip (ignored local output).

This is a repository/automation and package verification pass, not final product acceptance. Native fresh-install/UI/IPC testing, live Jira and guarded-write failure injection, authorized real-data migration, complete localization/accessibility, licensing decisions, and remaining performance/parity gates remain open. No license has been invented on the owner's behalf. Hosted CI results must be checked after synchronization.

## Packaged dependency correction

The entry-file inspection above was insufficient: both packagers omitted shared JSON required by Electron modules through ../shared. Fixed Windows and macOS packaging to include Resources/shared (resources/shared on Windows). Added tools/verify-package.mjs to load configuration, database, Jira management, provider, metadata, and page-budget modules from the distributed layout; Windows release CI now runs it and requires both JSON files in the ZIP.

Rebuilt Windows portable successfully and passed the packaged module load check. macOS script syntax passed; macOS packaging and native UI launch remain unverified. The replacement ZIP SHA-256 is 67178d9fa2a055a3f631d813f8a1ed2ff46928f85491d5a22a866d3699e32aad, superseding the earlier archive hash.

Both package builders now invoke the dependency verifier before archive creation, including direct local builds. The Windows build exercised this embedded check successfully. The release path filter includes verifier changes. A packaged Electron invocation in run-as-Node mode returned no captured output and is not accepted as native runtime verification.

## Backup/restore dialog workspace isolation

Backup and restore previously used the active database after awaiting native file selection, allowing a workspace switch during the dialog to change the operation's target. Both handlers now capture the starting database and reject a changed target immediately after selection; restore also checks it before replacement. The new VM regression executes the actual handler definitions with dialogs that switch workspaces and proves rejection before filesystem/worker access. It is included in test:workspaces. Handler syntax, this regression, and existing workspace tests passed; native dialog UI behavior remains unverified. Existing local release artifacts predate this fix and must be rebuilt before distribution.

Follow-up: applied the same workspace binding to profile import/export, with an additional check after asynchronous profile reading. Expanded the handler regression to cover both profile dialogs. test:workspaces and main-process syntax passed. Rebuilt the Windows package including all dialog fixes; its embedded dependency check passed. Current ZIP SHA-256: 89c5e8dac7338b475ab18b6cd8813762617679b5522a84687f5d6e90527e6da2. This supersedes the stale-artifact note and previous hashes; native UI acceptance is still open.

## Jira management workspace lifetime

Jira management handlers captured the initial database while credentials and transport followed the current workspace. Switching workspaces closed the captured connection. Handlers now resolve the active database per invocation; an operation counter prevents workspace switching and restore throughout asynchronous Jira management work and releases in finally. Provider checks now include active-database selection across calls, release after rejection, and retention during an injected network wait. Provider, dialog, and syntax checks passed. These are synthetic checks, not live Jira validation. The local portable artifact predates this latest main-process change and requires rebuilding.

Follow-up: configuration saves and PAT replacement/forget now reject while Jira management operations are in flight, preventing endpoint/policy or credential changes between the requests of a guarded mutation. Added actual-handler VM regression checks for all three guards. All eight suites passed; npm run verify then hit the known sandbox Vite realpath EPERM. A separate production build outside the sandbox passed (1,763 modules). This does not close native UI or live Jira gates.

## Current package and native launch attempt

Rebuilt Windows portable after the Jira operation fixes; embedded dependency verification passed. Current ZIP SHA-256: bafec6c5b4a6cfa391d913b31e541da0f8a433ea2f57809988b1f893a320067f.

Launched the packaged executable with PORTABLE_EXECUTABLE_DIR pointing to an isolated .tmp/native-smoke-workspace directory. It created a workspace registry, SQLite database/WAL, and Chromium caches there. An external harness supplied as a command-line app path did not produce its expected result; the owning launch was terminated after 45 seconds. This attempt does not prove that the packaged executable honored the harness argument, loaded the renderer, exposed preload, or completed IPC. Native acceptance remains open; use an Electron-aware runner against a raw runtime or attach to the packaged renderer for the next attempt. No user workspace was used.

## Native Electron IPC smoke

Retried with the cached official raw Electron 45.0.0 runtime and tools/native-smoke.cjs loading main.cjs from the packaged app. Passed renderer load, preload bridge, configuration and snapshot IPC, synthetic Objective save/list, creation of a second empty workspace, absence of the original record there, and record persistence after reopening the original workspace. All data lived under .tmp/native-full-smoke-workspace. The result reported ok=true and recordPersistenceVerified=true. Chromium emitted GPU state warnings; they did not fail these assertions.

To repeat, set AXILOOM_SMOKE_RESULT to an output JSON path and PORTABLE_EXECUTABLE_DIR to a disposable synthetic directory, then launch a raw Electron runtime with tools/native-smoke.cjs as its application argument. The test reads packaged files under release/Axiloom-Portable/resources/app, so rebuild them first. Check the output JSON, not merely the launcher exit code. This verifies real preload/IPC/SQLite behavior using packaged application files, but not direct portable-executable argument handling, backup/restore dialogs, native exports, accessibility, or live Jira.

## Native export smoke

Extended the same native harness to invoke exportXlsx/exportPdf with a synthetic report. Only save-dialog selection is stubbed to disposable paths; real IPC, report preparation, XLSX writing, hidden print BrowserWindow, and Electron printToPDF execute. Passed: XLSX 3,396 bytes with ZIP signature and PDF 15,329 bytes with PDF signature. Independently inspected workbook.xml and confirmed Evidence and Report Context sheets. The harness ignores secondary print-window creation so it cannot recursively run against the report window. Persistence and workspace-isolation assertions also passed in this run. This supersedes the native-export exclusion above for synthetic file generation only; PDF visual quality, real save-dialog interaction, full filtered-report parity, and accessibility remain unverified.
