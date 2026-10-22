# Metric semantics and data limits

The metric engine reads raw issue/sprint evidence through the active workspace configuration. A missing mapping or value is reported as unavailable; it is not silently converted to a known zero. Completion status, team, work classification, story points, sprint membership, and calendar rules must be configured for the relevant project and issue type. Numeric transforms accept finite numbers and numeric strings only; booleans, objects, empty strings, and malformed text remain unavailable.

Semantic field coverage follows the project/type binding selected for each issue. It reports invalid transformed values separately from explicit `null`, empty string, empty array, missing configured field, and an issue context with no applicable mapping. Invalid counts are warnings; the source value remains in the raw evidence.
`returned` and `present` are parent counts: the diagnostic counts for empty strings and invalid transforms can overlap with `present`. Multiple active meanings assigned to one Jira field are reported as an alias warning.

## Sprint boundaries and scope

- Actual sprint windows use activation and completion timestamps when present. Active sprint windows are bounded by the present or configured sprint end. Planned start/end dates are used for capacity.
- Completion includes Jira's `statusCategory=done`, a resolution date, or a completion status explicitly configured for the issue's project role.
- Point-in-time field values are reconstructed from available changelog events. Incomplete history is flagged; reconstructed values are not presented as certain when evidence is missing.
- Work classifications and tags are selected through configured mappings. Missing classifications remain unknown. Jira's Epic relationship, Jira issue links, and local product-record relationships are separate.

## Delivery and flow

- Planned delivery is completed planned points divided by planned points.
- Scope completion is completed points divided by points in the sprint scope.
- Scope churn is added plus removed points divided by opening committed points.
- Carryover counts issues that remain in scope and are incomplete at the sprint boundary.
- Cycle time uses the configured start and completion status semantics. Lead time begins at issue creation.
- Reopen rate counts issues that left a configured completion status within the sprint window.
- Forecasts use the configured lookback and available completed sprint history. Coverage and fallback method are exposed with the result.
- `timespent` history deltas are an estimate proxy, not Jira worklogs. Worklog detail is not inferred.

## Team attribution

Team precedence is shared by delivery and sprint-commitment reports: issue override, configured team field, board route, component assignment, project default. Team and rule active dates are inclusive UTC dates. Delivery evaluates the selected source at the sprint end; a commitment evaluates it when the issue enters the configured commitment state, or at sprint start when already committed. Report rows carry stable team IDs and hierarchy paths beside display names.

Unknown, inactive, ambiguous, and conflicting mappings generate distinct quality findings. An issue-sprint relationship without an active team remains visible in the explicit unmapped relationship count and detail list; team-only totals exclude it. Portfolio Epic team subtotals count distinct child issue keys using reportable sprint history, falling back to current issue attribution when no reportable history exists; because team attribution can change over time, one child may occur in multiple team subtotals. Epic-wide child counts remain unique.

## Capacity and calendar

Working days use the configured time zone, working weekdays, and holidays. Capacity can be overridden by team, sprint, person, working days, and allocation. Story points and hours remain separate measures. The current model does not claim support for every effective-dated allocation or cross-time-zone schedule edge case; see the acceptance record.

## Product and portfolio reports

Portfolio and product views use configured project roles and explicit issue keys or record relationships. Product links are not inferred from title similarity. Multiple team/component memberships can make subtotals overlap; totals are not necessarily unique issue counts. Product-to-delivery summaries show the available evidence and retain the relationship source.

## Interpretation

Missing denominators produce a blank ratio. Incomplete history and field coverage are displayed as quality limits. Employee measures are workload and flow diagnostics, not standalone performance decisions. Definitions shipped in `src/data/metric-definitions.json` are being generalized and reviewed; do not treat a renderer build as proof of parity with an external organization's historical reports.
