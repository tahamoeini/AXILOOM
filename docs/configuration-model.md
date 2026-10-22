# Configuration model

Axiloom starts with an unconfigured, organization-neutral workspace. It does not seed Jira projects, boards, teams, field IDs, status names, business taxonomy, or a work calendar. Analytical modules become available when their required mappings pass validation.

## Profile structure

Profiles use [`config-profile.schema.json`](../schemas/config-profile.schema.json) and are validated again in the Electron main process. The persisted record has a schema version and an incrementing configuration revision. Each semantic change creates an immutable revision and a fingerprint used by report-cache keys.

The profile contains:

- Organization display name, locale, and timezone.
- Selected Jira project keys and logical roles such as product intake, technical delivery, and commitments.
- Teams with stable IDs, display names, aliases, and optional active dates; Agile boards reference team IDs.
- Field bindings scoped by semantic key, project, and issue type. Provider field IDs are data supplied by the connected Jira catalog or the user, validated before persistence, and never interpolated into SQL or URL paths.
- Separate workflow policies for delivery, intake, and commitments, including completion and optional lifecycle/milestone states.
- Calendar timezone, weekdays, hours, holidays, and effective work intervals.
- Module switches. A module is enabled only when its declared prerequisites are mapped and valid.

## Resolution rules

More specific field bindings take precedence: issue type plus project, then project, then workspace-wide. Overlapping bindings at equal scope are rejected as ambiguous. A missing binding is reported as unmapped; the resolver does not guess from a field label or convert an unknown value to zero.

Team assignment follows configured board and field mappings plus explicit user overrides. If evidence produces multiple teams or no team, universal totals retain the work and team-specific views show the exclusion or conflict.

Workflow policies are scoped by logical role. Status-category completion can be used when the provider supplies it; named status mappings are versioned. Request, commitment, and delivery completion do not inherit one another's policy.

## Legacy profile handling

Older workspaces keep their existing project selections, board labels, thresholds, raw Jira payloads, revision history, imports, links, and product records. The migration records the prior configuration revision and marks the workspace for review. It does not infer custom-field bindings, status meaning, calendar, or product roles from project names. Analytics requiring those mappings stays unavailable until the user reviews and maps them.

Configuration profile import/export excludes authentication tokens. Import supports validation before applying a profile, and changes never rewrite raw Jira evidence.
