# Jira metadata and guarded mutations

Jira field, project, issue-type, board, and workflow metadata is discovered from the configured source and cached with its source context. Create and edit metadata is requested for the selected project, issue type, and issue. Allowed values and required fields come from that context, not from a static bundled tenant catalog.

The JSON importer can retain field/project/type catalog objects as local evidence. Imported metadata does not establish live permission and is never used as a substitute for current write metadata. Unknown fields remain readable; a required field without a supported value blocks submission rather than guessing.

Jira writes are separate from synchronization and require explicit user action. The current interface checks the relevant Jira permission, fetches the current version before field/status writes, and presents an explicit confirmation for destructive actions. A version check detects observed changes but is not an atomic server-side lock. If a transport failure occurs during a write, refresh the issue before retrying because the remote outcome may be unknown.

The implemented provider path uses Jira REST endpoints compatible with Server/Data Center and bearer personal access tokens over HTTPS. It has not been exercised against a live tenant in this mission. Jira Cloud OAuth is not implemented or supported. Do not infer support from the generic input schema.
