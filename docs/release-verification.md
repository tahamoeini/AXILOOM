# Release verification record

**Updated:** 2026-10-22
**Release status:** Not releasable. The renderer builds, but no desktop artifact has been produced. Public code currently ends at `e033caa`; local verification and schema-validation work beyond that commit is not published. No PR or CI review exists.

## Local checks

| Check | Result | Boundary |
|---|---|---|
| `npm run test:configuration` | Passed | Configuration validation and revision behavior, source rebind guards, pre-ingestion credential/metadata clearing, explicit legacy offline-source identity attestation, and rejection of malformed or newer profile schema versions. |
| `npm run test:data-access` | Passed twice consecutively after retaining prepared SQLite statements through iterator consumption | Synthetic Jira import, semantic mapping, team conflict/unknown/ambiguous attribution, sprint workflow status handling, filtered reports, and paginated export regression checks. |
| `npm run test:workspaces` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout | Two separate workspaces retain identical Jira issue IDs/keys and sprint IDs under distinct source identities. The default Windows sandbox temp directory failed during atomic registry replacement with `EPERM`; multi-source isolation within one workspace remains unsupported. |
| `npm run test:migration` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout | Synthetic schema-version-1 migration, dry-run cleanup, evidence reconciliation, source immutability, and no-overwrite checks. |
| `npm run build` | Passed with an escalated local build invocation | TypeScript and Vite production renderer build completed. The ordinary sandbox invocation fails at asynchronous Vite `realpath` with `EPERM`; synchronous `realpath` works. |
| `node --check` for Electron entry, preload, database, and Jira worker modules | Passed | Syntax check only; it does not prove desktop runtime behavior. |
| Renderer UI walkthrough | Passed for the renderer fixture | In the in-app browser, Overview and Objectives rendered; a synthetic Objective and an `Unknown` Outcome explicitly linked to it were saved. Settings loaded a synthetic profile into the draft, showed profile-export success, and saved the draft at mock configuration revision 2. The fixture uses an in-memory bridge; it does not exercise Electron IPC, native file dialogs, persistent SQLite, real profile files, Jira, report exports, or accessibility. |

## Packaging and delivery

`npm run build:portable` completed the renderer build, then stopped because the verified official Electron `45.0.0` Windows x64 runtime archive is not present in the local cache. The script exits before replacing release output. No portable package, archive, checksum, or fresh-install result was produced. macOS packaging was not run in this Windows environment.

GitHub API verification on 2026-10-22 confirms `tahamoeini/AXILOOM` is public, `codex/axiloom-transformation` is the default branch, and its latest public code commit is `e033caa4648020a50851b57e38b983f8001090a2`. No PR exists. Local `git ls-remote` previously failed with `getaddrinfo() thread failed to start`. An earlier attempt to create a separate public review branch was rejected by automatic review because public publication required explicit authorization for the exact destination and payload; that review branch was not created. Subsequent verification and schema-validation work remains local and unpublished. The Product360 source remains untouched.

No `LICENSE` file is present in the destination. The intended code license and release attribution remain undecided; do not represent the source as permissively licensed.

## Remaining release gates

- Real user-data migration and backup/restore recovery drill.
- Code license and attribution decision, third-party notices, and asset-provenance inventory.
- Injected failures during migration copy and manifest creation, with verified rollback/recovery.
- Live Jira Data Center verification; Jira Cloud OAuth is unimplemented and unclaimed.
- Cross-source instance isolation inside one workspace.
- Complete English/LTR translation, Persian/RTL review, keyboard/screen-reader accessibility, and responsive checks.
- Full metric baseline parity, report/export reconciliation, additional workflow/calendar profiles, and large-workspace performance measurements.
- Security failure injection, current-instance authorization checks, and independent review.
- Windows portable runtime, artifact inspection, checksums, and fresh-install/upgrade validation.
- PR review and CI results for the final acceptance evidence; this checkout's verification-record edits also need an authorized publication path.

See [`implementation-progress.md`](implementation-progress.md), [`workspace-migration.md`](workspace-migration.md), and [`risk-register.md`](risk-register.md) for package-level status and evidence.
