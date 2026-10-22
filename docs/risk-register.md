# Risk register

| ID | Risk | Impact | Mitigation / evidence required | Status |
|---|---|---|---|---|
| AX-R01 | Multiple source instances are not supported inside one workspace, and offline JSON files do not prove which Jira instance produced them. | Users needing two Jira sources must use separate workspaces; a mistaken offline source confirmation could still misattribute files. | A stable source identity is stored in workspace configuration; imports confirm one source label; rebinding is blocked after source evidence; credentials and cached endpoint metadata are cleared before ingestion; duplicate IDs are tested across workspaces. Verify Electron confirmation and keep the one-source boundary explicit. | Open |
| AX-R02 | Alternate project, team, field, and workflow policies lack parity evidence. | Reports can differ or omit work silently. | Use two independent profiles, immutable raw evidence, quality warnings, and report/export reconciliation. | Open |
| AX-R03 | The existing public GitHub destination has not received the local commits. | No hosted review, CI result, or release handoff exists. | The repository and push permission were verified; automatic review rejected the public push pending explicit authorization for this exact destination and payload. No branch or PR was created. | Authorization required |
| AX-R04 | No live Jira tenant was used for end-to-end provider validation. | Authentication, permissions, pagination, or writes may behave differently. | Limit claim to implementation path; run provider contract against an authorized non-production instance. | Open |
| AX-R05 | UI E2E and accessibility evidence are absent. | Renderer flows may fail despite a production bundle. | Walk through onboarding, mapping, report, product records, and restore in a real renderer; test keyboard and both directions. | Open |
| AX-R06 | No user-owned legacy database copy or migration utility is available. | Data preservation and historical interpretation cannot be proven. | Implement dry-run migration, copy/reconcile counts and hashes, and validate on an authorized backup. | Open |
| AX-R07 | Electron runtime archive is not cached and no package has been built. | No verified Windows installer/archive or artifact contents. | Fetch/verify the pinned official runtime when network is available, build, inspect, and hash outputs. | Open |
| AX-R08 | Jira mutation retry and partial-failure paths lack E2E evidence. | Duplicate remote writes or unknown outcomes are possible. | Keep explicit review and fresh-version checks; test transport failure before and after server commit. | Open |
| AX-R09 | Distributed source may still contain tenant terminology or assumptions. | Private identifiers or misleading examples can ship. | Run exact and semantic scans over source, docs, schemas, built assets, packages, and exports. | Open |
| AX-R10 | Calendar and locale edge cases are incomplete. | DST, working intervals, or date boundaries can alter capacity. | Use timezone-specific synthetic fixtures, half-open boundaries, and localization review. | Open |

This register records unresolved risks; listing a mitigation does not mean the risk is accepted or fixed.
