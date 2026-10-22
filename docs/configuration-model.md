# Configuration model

Axiloom starts with an unconfigured, organization-neutral workspace. It does not seed Jira projects, boards, teams, field IDs, status names, business taxonomy, or a work calendar. Analytical modules become available when their required mappings pass validation.

## Profile structure

The current profile shape is documented in [`config-profile.schema.json`](../schemas/config-profile.schema.json). Runtime validation in the Electron main process enforces field and cross-field rules before persistence. The persisted record has a schema version and an incrementing configuration revision. Each semantic change creates an immutable revision and a fingerprint used by report-cache keys.

Runtime validation treats missing versions as legacy input and migrates them to the current schema. Malformed, fractional, negative, and newer-than-supported versions are rejected before normalization; a profile import remains a draft until the user reviews it and saves it.

The profile contains:

- Organization display name, locale, and timezone.
- Selected Jira project keys and logical roles such as product intake, technical delivery, and commitments.
- Teams with stable IDs, display names, aliases, and optional active dates; Agile boards reference team IDs.
- Field bindings scoped by semantic key, project, and issue type. Provider field IDs are data supplied by the connected Jira catalog or the user, validated before persistence, and never interpolated into SQL or URL paths.
- Separate workflow policies for delivery, intake, and commitments, including completion and optional lifecycle/milestone states.
- Calendar timezone, weekdays, hours, holidays, and effective work intervals.
- Module switches. A module is enabled only when its declared prerequisites are mapped and valid.

Each workspace has one active source identity. The provider, stable source ID, and canonical endpoint cannot be changed after source evidence or local Jira links are present; connect another Jira instance in a separate workspace. Before ingestion, changing the source identity clears any saved Jira credential and metadata cached for the previous endpoint. Offline JSON imports require a user-confirmed source label that becomes part of that source identity. An older offline workspace with existing evidence but no source ID is bound only after the user confirms which source its existing data belongs to. Configuration profiles cannot move a workspace's existing evidence to a different source.

## Resolution rules

More specific field bindings take precedence: issue type plus project, then project, then workspace-wide. Overlapping bindings at equal scope are rejected as ambiguous. A missing binding is reported as unmapped; the resolver does not guess from a field label or convert an unknown value to zero.

Team assignment follows configured board and field mappings plus explicit user overrides. Team names and aliases are case-insensitively unique across teams; ambiguous labels are rejected at profile validation. When an issue's configured team differs from its sprint board route, the configured team remains the report attribution and a data-quality warning records the disagreement. Unknown or ambiguous issue-team values fall back to the board route with a warning. If neither source resolves a team, the issue remains in universal totals and is excluded from team-specific totals.

Workflow policies are scoped by logical role. Status-category completion can be used when the provider supplies it; named status mappings are versioned. Request, commitment, and delivery completion do not inherit one another's policy.

## Legacy profile handling

Older workspaces keep their existing project selections, board labels, thresholds, raw Jira payloads, revision history, imports, links, and product records. The migration records the prior configuration revision and marks the workspace for review. It does not infer custom-field bindings, status meaning, calendar, or product roles from project names. Analytics requiring those mappings stays unavailable until the user reviews and maps them.

Configuration profile import/export excludes authentication tokens. Import supports validation before applying a profile, and changes never rewrite raw Jira evidence.
