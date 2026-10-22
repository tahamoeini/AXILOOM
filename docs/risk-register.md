# Risk register

| ID | Risk | Impact | Mitigation / evidence required | Status |
|---|---|---|---|---|
| AX-R01 | Source instance identifiers are not independently keyed inside one workspace. | Two providers can collide if mixed in the same database. | Keep separate workspace databases; do not mix sources until source-scoped identity is implemented and tested. | Open |
| AX-R02 | Alternate project, team, field, and workflow policies lack parity evidence. | Reports can differ or omit work silently. | Use two independent profiles, immutable raw evidence, quality warnings, and report/export reconciliation. | Open |
| AX-R03 | No authorized GitHub destination remote is configured. | No verified hosted delivery or release. | Complete a local reviewable commit, then use an authorized existing destination or obtain approval for repository creation/visibility. | Blocking external target |
| AX-R04 | No live Jira tenant was used for end-to-end provider validation. | Authentication, permissions, pagination, or writes may behave differently. | Limit claim to implementation path; run provider contract against an authorized non-production instance. | Open |
| AX-R05 | UI E2E and accessibility evidence are absent. | Renderer flows may fail despite a production bundle. | Walk through onboarding, mapping, report, product records, and restore in a real renderer; test keyboard and both directions. | Open |
| AX-R06 | No user-owned legacy database copy or migration utility is available. | Data preservation and historical interpretation cannot be proven. | Implement dry-run migration, copy/reconcile counts and hashes, and validate on an authorized backup. | Open |
| AX-R07 | Electron runtime archive is not cached and no package has been built. | No verified Windows installer/archive or artifact contents. | Fetch/verify the pinned official runtime when network is available, build, inspect, and hash outputs. | Open |
| AX-R08 | Jira mutation retry and partial-failure paths lack E2E evidence. | Duplicate remote writes or unknown outcomes are possible. | Keep explicit review and fresh-version checks; test transport failure before and after server commit. | Open |
| AX-R09 | Distributed source may still contain tenant terminology or assumptions. | Private identifiers or misleading examples can ship. | Run exact and semantic scans over source, docs, schemas, built assets, packages, and exports. | Open |
| AX-R10 | Calendar and locale edge cases are incomplete. | DST, working intervals, or date boundaries can alter capacity. | Use timezone-specific synthetic fixtures, half-open boundaries, and localization review. | Open |

This register records unresolved risks; listing a mitigation does not mean the risk is accepted or fixed.
