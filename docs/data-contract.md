# Jira input and storage contract

Axiloom accepts common Jira REST JSON shapes: issue-search pages containing `issues[]`, sprint pages containing `values[]`, and individual issue or sprint objects. The schemas in `schemas/` describe these generic envelopes and intentionally allow provider-specific fields.

Each imported issue is retained as raw JSON. Unknown fields are preserved and can be inspected in the detail view. Missing fields, explicit `null`, empty collections, and known zero values remain distinguishable in the raw evidence. A normalized projection is derived only through the workspace's semantic field mappings.

Field coverage is calculated against the mapping selected for each issue's project and issue type. It distinguishes a returned value, explicit `null`, empty string, empty collection, missing configured field, invalid value for its configured transform, and a context with no applicable mapping. Invalid values remain unchanged in raw evidence and do not become zero.

Issue snapshots are deduplicated by stable identity and selected by the source update time. Partial updates carry forward fields that were not returned, while explicit `null` and empty values remain meaningful. Conflicting same-time payloads are recorded for review. Issue and sprint revisions, import provenance, changelog coverage, and explicit local link history are retained.

Jira issue, sprint, board, and history identifiers are provider values. A workspace database isolates them from other workspace databases. The current implementation does not yet provide multiple independently identified source instances within one workspace; treat that as an open boundary.

`schemas/jira-field-catalog.schema.json` describes discovered runtime metadata only. A static organization field catalog is not shipped. Create/edit options and permissions must be fetched for the relevant project, issue type, and user context; read metadata does not grant write permission.

The importer does not contact Jira. Direct synchronization and explicit Jira mutations use the configured connection path; provider-specific behavior still requires live verification before production use.
