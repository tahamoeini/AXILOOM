# Release verification record

**Updated:** 2026-10-22
**Release status:** Not releasable. The renderer builds, but no desktop artifact has been produced. WP08 implementation commit is `05f44d6d96e3dfca8ac8f6842d19d98ec219d6cb`, followed by WP09 implementation commit `cb31cbe82d3be3ee4f7bb99d05f5b26dca65c860` and evidence commit `8484c40cf4a4c643fdf0009e56b06dd0c14fc0ba` on the public default branch `codex/axiloom-transformation`. The WP09 follow-up `fbb95c277d88db1957479e6867a0a551d0f6c2e1` passed local validation but has not been pushed. GitHub API verification on 2026-10-22 confirmed both baseline WP09 commits are present. No open PR or PR-triggered workflow run is associated with WP09. There is no separate review-branch, PR review, or PR CI evidence.

## Local checks

| Check | Result | Boundary |
|---|---|---|
| `npm run test:configuration` | Passed after WP10 changes | Schema version 4 normalization, v1/v2 team-name-to-ID capacity overrides, effective date scopes, calendar intervals, typed built-in/custom record templates, enum and reference validation, and rejection of unsupported executable field types. |
| `npm run test:providers` | Passed | Provider descriptors, source attestation, private/public DNS policy, pinned endpoint construction, HTTP failure categories with secret redaction, Retry-After handling, no automatic write retries, and cancellation. Native TLS verification and live Jira remain unexercised. |
| `npm run test:data-access` | Passed after WP10 relationship assertions | Synthetic Jira import; explicit record-to-record and record-to-Jira links; endpoint and duplicate checks; required evidence, origin and attribution; archive/restore history; snapshot provenance; plus metric behavior, DST, holidays, split shifts, and effective capacity overrides. |
| `npm run test:semantic-mappings` | Passed after WP09 changes | Project/type precedence, context-aware changelog mapping, nullable transforms, alias/invalid findings, two-profile normalized facts/coverage/metric parity, role-specific completion, and prototype-key rejection. |
| `npm run test:workspaces` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout | Two separate workspaces retain identical Jira issue IDs/keys and sprint IDs under distinct source identities. The default Windows sandbox temp directory failed during atomic registry replacement with `EPERM`; multi-source isolation within one workspace remains unsupported. |
| `npm run test:migration` | Passed with `TEMP`/`TMP` redirected into `.test-tmp` inside the checkout after updating destination database schema to 9 and configuration schema to 4 | Synthetic schema-version-1 migration, destination relationship ledger creation, dry-run cleanup, evidence reconciliation, source immutability, and no-overwrite checks. |
| `npm run test:reporting` | Passed after WP11 | Report scope normalization, row/filter safety, and generated XLSX package content were checked. Electron IPC/native dialogs and PDF output remain unverified. |
| `npm run build` | Passed after WP11 changes with an escalated local build invocation | TypeScript and Vite production renderer build completed, with 1,760 modules transformed. The ordinary sandbox invocation fails at asynchronous Vite `realpath` with `EPERM`. |
| `node --check` and profile-schema JSON parse | Passed for semantic mapping, database, metrics, and business-sprint modules; schema JSON parsed | Syntax and parse checks only; they do not prove desktop runtime behavior. |
| Renderer UI walkthrough | Passed for the renderer fixture | In the in-app browser, Product register rendered Product/Initiative/Objective tabs and a typed Initiative form. A synthetic legacy Jira reference appeared as a suggestion; the explicit relationship was saved with evidence, Jira origin, source reference, and named attribution, then appeared in the record UI with event history. The generic Export relationships action returned the synthetic CSV path. Settings rendered and validated the typed template registry. Earlier Overview, WP06–WP09 renderer checks remain. The fixture uses an in-memory bridge; it does not exercise Electron IPC, native CSV save dialogs, persistent SQLite, real profile files, real credentials, Jira, actual XLSX/PDF files, or accessibility. |

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
- Full metric baseline parity, report/export reconciliation, additional workflow/calendar profiles, and large-workspace performance measurements.
- Security failure injection, current-instance authorization checks, and independent review.
- Windows portable runtime, artifact inspection, checksums, and fresh-install/upgrade validation.
- PR review and CI results for the final acceptance evidence; this checkout's verification-record edits also need an authorized publication path.

See [`implementation-progress.md`](implementation-progress.md), [`workspace-migration.md`](workspace-migration.md), and [`risk-register.md`](risk-register.md) for package-level status and evidence.
