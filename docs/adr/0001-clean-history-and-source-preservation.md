# ADR 0001: Clean distributable history and preserve source evidence

**Status:** Accepted for implementation  
**Date:** 2026-10-22

## Context

The mission requires a distributable AXILOOM product with no source-organization values, while the existing Axiloom repository and user workspaces must remain intact. The destination checkout arrived with an unborn branch and all 63 source files staged. The named GitHub destination is not accessible through the connected account at inspection time.

## Decision

- Keep all changes inside the AXILOOM checkout; do not edit or rewrite the source repository.
- Preserve the arrived worktree and staged content until an audited sanitized tree is ready.
- Create the AXILOOM repository history from a sanitized tree so removed source-specific values are not recoverable from an earlier commit.
- Provide an explicit, backed-up, versioned migration for existing local workspaces; never bundle personal database files or credentials.
- Do not force-push or overwrite any remote. Verify remote contents and permissions before publishing.

## Consequences

The first AXILOOM commit must wait until the initial tree and fixtures pass the source-specific content audit. Local development and evidence documentation can proceed before a GitHub repository exists. If repository creation or visibility is not available through authorized tooling, the implementation remains local and the delivery blocker is reported precisely.
