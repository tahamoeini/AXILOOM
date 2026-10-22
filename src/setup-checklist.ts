import type { AppConfig } from './types';

export interface SetupStep {
  id: string;
  label: string;
  complete: boolean;
  optional: boolean;
}

export function buildSetupSteps(config: AppConfig, workspaceReady: boolean, issueCount: number): SetupStep[] {
  const projectModulesEnabled = config.modules.delivery || config.modules.portfolio || config.modules.productIntake || config.modules.commitments || config.modules.businessSprint;
  const deliveryEnabled = config.modules.delivery || config.modules.businessSprint;
  const hasSource = Boolean(config.jiraUrl || config.sourceInstance.displayName.trim());
  const workflowScopes = [
    config.modules.delivery && 'delivery',
    config.modules.productIntake && 'intake',
    (config.modules.commitments || config.modules.businessSprint) && 'commitment',
  ].filter((scope): scope is 'delivery' | 'intake' | 'commitment' => Boolean(scope));
  const hasWorkflow = workflowScopes.length > 0 && workflowScopes.every((scope) => Object.entries(config.workflows[scope])
    .some(([key, value]) => key !== 'milestones' && Array.isArray(value) && value.length > 0));
  const hasTeamAttribution = config.teams.some((team) => team.name.trim())
    && (config.teamAssignments.projects.length > 0 || config.teamAssignments.components.length > 0 || config.boardRoutes.length > 0
      || config.fieldMappings.some((mapping) => mapping.semanticKey === 'team'));

  return [
    { id: 'settings-workspace', label: 'Workspace', complete: workspaceReady, optional: false },
    { id: 'settings-connection', label: 'Provider or import source', complete: hasSource, optional: false },
    { id: 'settings-projects', label: 'Project roles', complete: config.projects.length > 0 && Object.values(config.projectRoles).some((role) => role.length > 0), optional: !projectModulesEnabled },
    { id: 'settings-teams', label: 'Teams and board attribution', complete: hasTeamAttribution, optional: !deliveryEnabled },
    { id: 'settings-fields', label: 'Semantic fields', complete: config.fieldMappings.some((mapping) => ['storyPoints', 'sprint', 'team'].includes(mapping.semanticKey)), optional: !deliveryEnabled },
    { id: 'settings-workflows', label: 'Workflow definitions', complete: projectModulesEnabled && hasWorkflow, optional: !projectModulesEnabled },
    { id: 'settings-calendar', label: 'Calendar', complete: config.calendar.configured || config.calendar.workIntervals.length > 0, optional: !deliveryEnabled },
    { id: 'settings-modules', label: 'Modules', complete: Object.values(config.modules).some(Boolean), optional: false },
    { id: 'settings-review', label: 'Validate and save', complete: config.configurationRevision > 0, optional: false },
    { id: 'import-json-action', label: 'Import Jira data', complete: issueCount > 0 && hasSource, optional: !hasSource },
  ];
}
