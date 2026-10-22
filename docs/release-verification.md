# Release verification record

**Updated:** 2026-10-22
**Release status:** Not releasable. The renderer builds, but no desktop artifact has been produced. WP08 implementation commit is `05f44d6d96e3dfca8ac8f6842d19d98ec219d6cb`, followed by WP09 implementation commit `cb31cbe82d3be3ee4f7bb99d05f5b26dca65c860` and evidence commit `8484c40cf4a4c643fdf0009e56b06dd0c14fc0ba` on the public default branch `codex/axiloom-transformation`. The WP09 follow-up `fbb95c277d88db1957479e6867a0a551d0f6c2e1` passed local validation but has not been pushed. GitHub API verification on 2026-10-22 confirmed both baseline WP09 commits are present. No open PR or PR-triggered workflow run is associated with WP09. There is no separate review-branch, PR review, or PR CI evidence.

## Local checks

| Check | Result | Boundary |
|---|---|---|
| `npm run test:configuration` | Passed after WP10 changes | Schema version 4 normalization, v1/v2 team-name-to-ID capacity overrides, effective date scopes, calendar intervals, typed built-in/custom record templates, enum and reference validation, and rejection of unsupported executable field types. |
| `npm run test:providers` | Passed | Provider descriptors, source attestation, private/public DNS policy, pinned endpoint construction, HTTP failure categories with secret redaction, Retry-After handling, no automatic write retries, and cancellation. Native TLS verification and live Jira remain unexercised. |
| `npm run test:data-access` | Passed after WP13 schema-v10 record paging | Synthetic Jira import; explicit record-to-record and record-to-Jira links; SQL record search, filters, pages, bounded event history, targeted link summaries, snapshot row omission, and index-plan assertions, plus existing metric and calendar boundaries. |
| `npm run test:semantic-mappings` | Passed after WP09 changes | Project/type precedence, context-aware changelog mapping, nullable transforms, alias/invalid findings, two-profile normalized facts/coverage/metric parity, role-specific completion, and prototype-key rejection. |
| `npm run test:workspaces` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout | Two separate workspaces retain identical Jira issue IDs/keys and sprint IDs under distinct source identities. The default Windows sandbox temp directory failed during atomic registry replacement with `EPERM`; multi-source isolation within one workspace remains unsupported. |
| `npm run test:migration` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout after updating destination database schema to 10 and configuration schema to 4 | Synthetic schema-version-1 migration, destination relationship ledger and paging indexes, dry-run cleanup, evidence reconciliation, source immutability, and no-overwrite checks. |
| `npm run test:reporting` | Passed after WP11 | Report scope normalization, row/filter safety, and generated XLSX package content were checked. Electron IPC/native dialogs and PDF output remain unverified. |
| `npm run test:setup` | Passed after WP12 | Local product-only profiles leave unrelated source and delivery configuration optional; defaults do not appear user-configured. A synthetic delivery profile completes the configured steps. |
| `npm run build` | Passed after WP13 record paging changes with an escalated local build invocation | TypeScript and Vite production renderer build completed, with 1,761 modules transformed. The ordinary sandbox invocation fails at asynchronous Vite `realpath` with `EPERM`. |
| 50 MB synthetic workspace benchmark | Passed | 6,400 issues / 640 records; SQLite 54,759,424 bytes; issue page p50/p95 70.94/151.66 ms; record page 2.77/3.86 ms; snapshot 1,178.24 ms / 2,275 bytes; peak RSS 219,492,352 bytes. |
| 500 MB synthetic workspace benchmark | Passed | 64,000 issues / 6,400 records; SQLite 545,136,640 bytes; issue page p50/p95 98.06/150.53 ms; record page 10.92/14.81 ms; snapshot 11,894.20 ms / 2,291 bytes; peak RSS 1,361,117,184 bytes. The 1 GB profile is unmeasured, and no performance budget has been set. |
| `node --check` and profile-schema JSON parse | Passed for semantic mapping, database, metrics, and business-sprint modules; schema JSON parsed | Syntax and parse checks only; they do not prove desktop runtime behavior. |
| Renderer UI walkthrough | Passed for the renderer fixture | In the in-app browser, Product register rendered Product/Initiative/Objective tabs and a typed Initiative form. A synthetic legacy Jira reference appeared as a suggestion; the explicit relationship was saved with evidence, Jira origin, source reference, and named attribution, then appeared in the record UI with event history. The generic Export relationships action returned the synthetic CSV path. Settings rendered and validated the typed template registry. A blank product-only onboarding preview marked Jira/team/project/workflow/calendar setup optional; search filtered the settings index and a checklist action focused its section. Earlier Overview, WP06–WP09 renderer checks remain. The fixture uses an in-memory bridge; it does not exercise Electron IPC, native saves, persistent SQLite, real credentials, Jira, actual XLSX/PDF files, full localization, accessibility, or exact 1024px/1440px responsive widths. |

## Packaging and delivery

`npm run build:portable` completed the renderer build, then stopped because the verified official Electron `45.0.0` Windows x64 runtime archive is not present in the local cache. The script exits before replacing release output. No portable package, archive, checksum, or fresh-install result was produced. macOS packaging was not run in this Windows environment.

GitHub API verification on 2026-10-22 confirmed `tahamoeini/AXILOOM` is public and `codex/axiloom-transformation` is the default branch. WP09 commits `cb31cbe82d3be3ee4f7bb99d05f5b26dca65c860` and `8484c40cf4a4c643fdf0009e56b06dd0c14fc0ba` are present. The validated follow-up `fbb95c277d88db1957479e6867a0a551d0f6c2e1` remains local until the final delivery stage. No open PR or PR-triggered workflow run was returned for WP09. Local `git ls-remote` previously failed with `getaddrinfo() thread failed to start`. An earlier attempt to create a separate public review branch was rejected by automatic review; no new review branch has been created. The Product360 source remains untouched.

No `LICENSE` file is present in the destination. The intended code license and release attribution remain undecided; do not represent the source as permissively licensed.

## Remaining release gates

- Real user-data migration and backup/restore recovery drill.
- Code license and attribution decision, third-party notices, and asset-provenance inventory.
- Injected failures during migration copy and manifest creation, with verified rollback/recovery.
- Live Jira Data Center verification; Jira Cloud OAuth is unimplemented and unclaimed.
- Cross-source instance isolation inside one workspace.
- Complete English/LTR translation, Persian/RTL review, keyboard/screen-reader accessibility, and responsive checks.
- Full metric baseline parity, report/export reconciliation, additional workflow/calendar profiles, relationship-history paging, renderer-side full-record export memory, cancellation/progress for report exports, and a 1 GB performance measurement.
- Security failure injection, current-instance authorization checks, and independent review.
- Windows portable runtime, artifact inspection, checksums, and fresh-install/upgrade validation.
- PR review and CI results for the final acceptance evidence; this checkout's verification-record edits also need an authorized publication path.

See [`implementation-progress.md`](implementation-progress.md), [`workspace-migration.md`](workspace-migration.md), and [`risk-register.md`](risk-register.md) for package-level status and evidence.
