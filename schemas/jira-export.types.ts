/**
 * Generic read-side types for common Jira REST issue and sprint envelopes.
 * Provider-specific custom fields remain open data and are interpreted only
 * through the workspace's configured semantic field mappings.
 */
export type JiraDateTimeString = string;
export type JiraIdentifier = string | number;
export type JiraIssueKey = string;
export type JiraRawObject = Record<string, unknown>;

export interface JiraIssue {
  id: JiraIdentifier;
  key: JiraIssueKey;
  self?: string;
  fields: JiraRawObject;
  changelog?: JiraRawObject;
  names?: Record<string, string>;
  schema?: JiraRawObject;
  [key: string]: unknown;
}

export interface JiraIssuePage {
  issues: JiraIssue[];
  startAt?: number;
  maxResults?: number;
  total?: number;
  names?: Record<string, string>;
  schema?: JiraRawObject;
  [key: string]: unknown;
}

export interface JiraSprint {
  id: JiraIdentifier;
  name?: string;
  state?: string;
  startDate?: JiraDateTimeString | null;
  endDate?: JiraDateTimeString | null;
  completeDate?: JiraDateTimeString | null;
  activatedDate?: JiraDateTimeString | null;
  originBoardId?: JiraIdentifier | null;
  [key: string]: unknown;
}

export interface JiraSprintPage {
  values: JiraSprint[];
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
  [key: string]: unknown;
}

export interface DiscoveredJiraField {
  id: string;
  name: string;
  schema?: JiraRawObject;
  custom?: boolean;
  searchable?: boolean;
  orderable?: boolean;
  [key: string]: unknown;
}

export interface DiscoveredJiraFieldCatalog {
  schemaVersion: 1;
  sourceId: string;
  discoveredAt?: JiraDateTimeString;
  fields: DiscoveredJiraField[];
}
