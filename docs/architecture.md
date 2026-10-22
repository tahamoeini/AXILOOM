# Architecture and data boundaries

## Implemented structure

Axiloom is an Electron desktop application with a React/TypeScript renderer, SQLite workspaces, worker-based import and reporting, a Jira REST integration, and local report export. The main process owns persistence, network access, credentials, workspace operations, and guarded Jira mutations. The renderer calls a typed preload bridge and does not open SQLite directly.

Raw Jira issues, sprints, changelog evidence, import provenance, local product records, revision events, and explicit relationship records are durable workspace data. Semantic projections and report caches are derived data. Configuration revisions and source context contribute to the calculations and cache fingerprints.

## Current boundaries and gaps

- Each workspace database is bound to one stable source identity in its versioned configuration. A source identity change is rejected once issue, sprint, import, tombstone, history, or local Jira-link evidence exists; before ingestion, encrypted credentials and cached Jira metadata for the previous source are cleared. Offline imports require the user to confirm one source name for the whole workspace; older unbound offline data can receive an identity only through an explicit import attestation. Independent sources in one workspace are not yet supported; use separate workspaces to isolate them.
- Jira field values are resolved through configured project/type-scoped semantic mappings. Not every report has yet been proven to use a single policy path.
- Project roles, teams, workflows, calendar rules, and modules are configurable. The UI and product-record workflow still contain fixed labels and mostly Persian copy.
- The provider registry exposes offline JSON import and Jira Server/Data Center bearer-token access. The main process and sync worker share an HTTPS transport that validates the full DNS answer set, pins the selected address per request, rejects redirects, keeps TLS verification enabled, and retries only read-only requests. Public Jira requires a versioned `public-pinned` setting with administrator-approved IPv4 addresses. Jira Cloud OAuth is not implemented.
- Provider capability descriptors show the available import, discovery, read-only sync, and user-initiated write operations. PAT metadata is whitelisted before it reaches the renderer; forgetting a credential clears both session and encrypted local storage, and remote token revocation clears the local credential after Jira confirms the revoke.
- Product records support explicit references, but a complete typed relation model with source, creator, revision, and evidence for every edge remains unfinished.

## Target invariants

- Workspace and provider identities must be stable and separately scoped.
- Raw source evidence is append-only where possible; policy changes create a new configuration revision rather than rewriting evidence.
- Missing, null, empty, invalid, ambiguous, and known-zero values remain distinguishable.
- Reports, data quality, filters, and exports use the same effective configuration revision.
- Similarity can suggest a relationship but never creates one without user action.
- Backups exclude credentials and are verified before restore; migration is dry-run capable and reconciles source and destination evidence.
- Automatic synchronization is read-only. Writes remain user-initiated, permission checked, reviewable, and guarded against stale versions.

## Verification status

Focused configuration, data-access, and workspace-isolation suites pass. The architecture still needs alternate-profile report parity, a legacy database migration drill, live provider verification, renderer E2E, security review, and package-content inspection. See [`implementation-progress.md`](implementation-progress.md).
