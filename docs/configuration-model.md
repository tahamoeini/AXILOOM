# Configuration model

Axiloom starts with an unconfigured, organization-neutral workspace. It does not seed Jira projects, boards, teams, field IDs, status names, business taxonomy, or a work calendar. Analytical modules become available when their required mappings pass validation.

## Profile structure

The current profile shape is documented in [`config-profile.schema.json`](../schemas/config-profile.schema.json). Runtime validation in the Electron main process enforces field and cross-field rules before persistence. The persisted record has a schema version and an incrementing configuration revision. Each semantic change creates an immutable revision and a fingerprint used by report-cache keys.

Runtime validation treats missing versions as legacy input and migrates them to the current schema. Version 1 profiles gain private-network access defaults; version 1 and 2 capacity overrides migrate from team labels to stable team IDs; version 4 adds validated typed record templates. Malformed, fractional, negative, and newer-than-supported versions are rejected before normalization; a profile import remains a draft until the user reviews it and saves it.

The profile contains:

- Organization display name, locale, and timezone.
- Selected Jira project keys and logical roles such as product intake, technical delivery, and commitments.
- Teams with stable IDs, display names, aliases, optional parent IDs, and inclusive UTC active dates. Report rows retain the team ID alongside the display name.
- Effective-dated board-to-team routes, project defaults, component assignments, and reviewed issue-specific overrides. A board may move to another team through non-overlapping dated routes.
- Field bindings scoped by semantic key, project, and issue type. Provider field IDs are data supplied by the connected Jira catalog or the user, validated before persistence, and never interpolated into SQL or URL paths.
- Separate workflow policies for delivery, intake, and commitments, including completion and optional lifecycle/milestone states.
- Calendar timezone, weekdays, holidays, daily work intervals, and nominal working-day hours. Date-only sprint start and end dates include both local dates; offset-aware timestamp bounds preserve their source instants and use half-open overlap. Intervals support partial-day boundaries and DST-aware elapsed hours. Without explicit intervals, a touched partial working date is counted as a full day and marked approximate.
- Capacity overrides keyed by stable team ID and assignee key, scoped to a sprint or inclusive effective dates. A name-based override from an older profile is migrated to the existing stable team ID. Capacity inferred from issue assignees defaults to 100% and remains labeled as an estimate because the product does not have an authoritative staffing roster.
- Module switches. A module is enabled only when its declared prerequisites are mapped and valid.
- Product record templates. Template keys, labels, grouping, enablement, fields, required values, enum options, and record-reference targets are configuration data. Supported field types are `text`, `textarea`, `date`, `enum`, `recordRef`, `issueRef`, `issueRefList`, `number`, and `boolean`; executable scripts and arbitrary form handlers are not accepted. Product, Initiative, and Objective use the strategy register. Custom templates can be added through the validated template registry.

Each workspace has one active source identity. The provider, stable source ID, and canonical endpoint cannot be changed after source evidence or local Jira links are present; connect another Jira instance in a separate workspace. Before ingestion, changing the source identity clears any saved Jira credential and metadata cached for the previous endpoint. Offline JSON imports require a user-confirmed source label that becomes part of that source identity. An older offline workspace with existing evidence but no source ID is bound only after the user confirms which source its existing data belongs to. Configuration profiles cannot move a workspace's existing evidence to a different source.

Jira connection policy is separate from source identity. The default `private` mode permits HTTPS endpoints whose complete DNS answer set is private, loopback, or link-local. `public-pinned` requires administrator-approved public IPv4 addresses; every request checks that DNS resolves only to that allowlist and connects to a pinned address. TLS certificate verification remains enabled and redirects are rejected. Public IPv6 endpoints are not supported by this mode. Changing the network policy creates a configuration revision without reassigning imported evidence.

The provider registry currently exposes offline JSON import and Jira Server/Data Center bearer-token access. Capability descriptors distinguish project/field discovery, read-only sync, and user-initiated writes. Issue write permissions are checked against Jira before the action. Jira Cloud remains unsupported pending a separately registered and tested OAuth 2.0 integration.

## Resolution rules

More specific field bindings take precedence: issue type plus project, then project, then workspace-wide; an issue-type-only binding applies between project-specific and workspace-wide bindings. Overlapping bindings at equal scope are rejected for the same semantic key. A source field actively mapped to multiple meanings is allowed as an explicit alias and surfaced in data-quality findings for review. The changelog resolver uses the issue's current project and issue type for configured field IDs and names; it leaves conflicting or out-of-scope configured IDs unmapped instead of guessing from a familiar display name.

Team attribution uses the first active source in this order: issue-specific override, configured team field, board route, component assignment, then project default. Dates are inclusive UTC calendar dates. Delivery reports evaluate the assignment at the actual sprint end; commitment reports use the commitment-entry date or sprint start. The source selected for a row retains its stable team ID and hierarchy path. Other active sources that disagree remain visible as attribution conflicts.

Team names and aliases are case-insensitively unique across teams; ambiguous labels are rejected at profile validation. Unknown, inactive, ambiguous, and conflicting source values remain separate data-quality states. If no active source resolves an issue-sprint relationship, it remains visible in the explicit unmapped relationship count and detail list, and is excluded from team-only aggregates. Board routing is optional when another supported team source is configured. Portfolio Epic team groups use distinct child issue keys from reportable sprint history, falling back to current issue attribution when no reportable history exists; a child that moved between teams can appear in more than one team subtotal, while the Epic's universal child total stays unique.

Workflow policies are scoped by logical role. Status-category completion can be used when the provider supplies it; named status mappings are versioned. Request, commitment, and delivery completion do not inherit one another's policy.

## Legacy profile handling

Older workspaces keep their existing project selections, board labels, thresholds, raw Jira payloads, revision history, imports, links, and product records. The migration records the prior configuration revision and marks the workspace for review. It does not infer custom-field bindings, status meaning, calendar, or product roles from project names. Analytics requiring those mappings stays unavailable until the user reviews and maps them.

Configuration profile import/export excludes authentication tokens. Import supports validation before applying a profile, and changes never rewrite raw Jira evidence.
