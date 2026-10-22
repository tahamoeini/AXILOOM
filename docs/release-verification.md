# Release verification record

**Updated:** 2026-10-22
**Release status:** Not releasable. The renderer builds, but no desktop artifact has been produced. Current WP06 commit is `27c00b245cb8ab074bf6ff87111a2ac82d4e5903`, following WP05 commit `e4a314244e4839a9cbc8c470598168c3fe1eab20`. The local branch and its origin-tracking ref point to WP06; GitHub API confirms the commit exists and confirms `codex/axiloom-transformation` is the public default branch. No PR exists, and the PR-triggered workflow query returned no runs for this commit. This revision has no separate PR review or PR CI evidence.

## Local checks

| Check | Result | Boundary |
|---|---|---|
| `npm run test:configuration` | Passed | Configuration validation and revision behavior, source rebind guards, pre-ingestion credential/metadata clearing, explicit legacy offline-source identity attestation, and rejection of malformed or newer profile schema versions. |
| `npm run test:providers` | Passed | Provider descriptors, source attestation, private/public DNS policy, pinned endpoint construction, HTTP failure categories with secret redaction, Retry-After handling, no automatic write retries, and cancellation. Native TLS verification and live Jira remain unexercised. |
| `npm run test:data-access` | Passed twice consecutively after retaining prepared SQLite statements through iterator consumption | Synthetic Jira import, semantic mapping, team conflict/unknown/ambiguous attribution, sprint workflow status handling, filtered reports, and paginated export regression checks. |
| `npm run test:semantic-mappings` | Passed | Project/type precedence, context-aware changelog mapping, nullable transforms, alias and invalid-value findings, and equivalent normalized facts, coverage, and metric summaries for two synthetic profiles with different custom-field IDs. |
| `npm run test:workspaces` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout | Two separate workspaces retain identical Jira issue IDs/keys and sprint IDs under distinct source identities. The default Windows sandbox temp directory failed during atomic registry replacement with `EPERM`; multi-source isolation within one workspace remains unsupported. |
| `npm run test:migration` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout | Synthetic schema-version-1 migration, dry-run cleanup, evidence reconciliation, source immutability, and no-overwrite checks. |
| `npm run build` | Passed with an escalated local build invocation | TypeScript and Vite production renderer build completed. The ordinary sandbox invocation fails at asynchronous Vite `realpath` with `EPERM`; synchronous `realpath` works. |
| `node --check` for semantic mapping and metrics modules, plus prior Electron entry/preload/database/configuration/provider checks | Passed | Syntax checks only; they do not prove desktop runtime behavior. |
| Renderer UI walkthrough | Passed for the renderer fixture | In the in-app browser, Overview and Objectives rendered; a synthetic Objective and an `Unknown` Outcome explicitly linked to it were saved. WP06 Settings dry-run imported a synthetic Jira DC profile, displayed its team hierarchy, project/component/issue assignments, semantic team mapping, and dated board route; the route end date was changed to `2026-07-15` and saved at mock revision 2. Earlier smoke steps exercised public-pinned selection, project/type mapping scope, session-token use/forget, mock Jira token list/revocation, read-only sync start, and cancellation through `cancelled`. Data Quality rendered the invalid, empty-string, and unmapped headings with zero issues. The fixture uses an in-memory bridge; it does not exercise Electron IPC, native file dialogs, persistent SQLite, real profile files, real credentials, Jira, populated attribution UI/exports, or accessibility. |

## Packaging and delivery

`npm run build:portable` completed the renderer build, then stopped because the verified official Electron `45.0.0` Windows x64 runtime archive is not present in the local cache. The script exits before replacing release output. No portable package, archive, checksum, or fresh-install result was produced. macOS packaging was not run in this Windows environment.

GitHub API verification on 2026-10-22 confirms `tahamoeini/AXILOOM` is public and `codex/axiloom-transformation` is the default branch. The WP06 commit `27c00b245cb8ab074bf6ff87111a2ac82d4e5903` is present in the repository and the local branch matches its origin-tracking ref. No PR exists; no PR-triggered workflow run was returned for the commit. Local `git ls-remote` previously failed with `getaddrinfo() thread failed to start`. An earlier attempt to create a separate public review branch was rejected by automatic review; no new review branch has been created. The Product360 source remains untouched.

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
