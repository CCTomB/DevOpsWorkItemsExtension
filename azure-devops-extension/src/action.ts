import * as SDK from 'azure-devops-extension-sdk';
import { Build, BuildRestClient } from 'azure-devops-extension-api/Build';
import { getClient } from 'azure-devops-extension-api';

const pipelineName = 'BulkAssignCommitHashToManyWorkItems';
const statusElement = document.getElementById('status');

function setStatus(message: string): void {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function collectIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectIds);
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return [value];
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return [Number(value.trim())];
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['workItemIds', 'selectedWorkItemIds', 'workItemId', 'id']) {
      if (key in record) {
        const ids = collectIds(record[key]);
        if (ids.length > 0) {
          return ids;
        }
      }
    }
  }

  return [];
}

function getSelectedWorkItemIds(actionContext: unknown): number[] {
  const configuration = SDK.getConfiguration() as Record<string, unknown>;
  const candidates = [
    actionContext,
    configuration.witInputs,
    configuration.workItemIds,
    configuration.selectedWorkItemIds,
    configuration
  ];

  return [...new Set(candidates.flatMap(collectIds))];
}

function getCommitHash(): string {
  const commitHash = window.prompt('Enter the Git commit hash to link to the selected work items:')?.trim();
  if (!commitHash) {
    throw new Error('Commit hash entry was cancelled.');
  }

  if (!/^[0-9a-f]{7,64}$/i.test(commitHash)) {
    throw new Error('Enter a Git commit hash between 7 and 64 hexadecimal characters.');
  }

  return commitHash;
}

async function queuePipeline(workItemIds: number[], commitHash: string): Promise<void> {
  const webContext = SDK.getWebContext();
  const projectId = webContext.project?.id;
  if (!projectId) {
    throw new Error('The current Azure DevOps project could not be determined.');
  }

  const buildClient = getClient(BuildRestClient);
  const definitions = await buildClient.getDefinitions(projectId, pipelineName);
  const definition = definitions.find((candidate) => candidate.name === pipelineName) ?? definitions[0];

  if (!definition?.id) {
    throw new Error(`Pipeline '${pipelineName}' was not found in the current project.`);
  }

  const queuedBuild = await buildClient.queueBuild({
    definition,
    templateParameters: {
      workItemId: workItemIds.join(','),
      commitHash
    }
  } as unknown as Build, projectId, undefined, undefined, undefined, definition.id);

  const buildNumber = queuedBuild.buildNumber ?? String(queuedBuild.id ?? '');
  setStatus(`Queued ${pipelineName} for ${workItemIds.length} work items${buildNumber ? ` (run ${buildNumber})` : ''}.`);
}

SDK.register('bulk-assign-commit-hash-action', () => ({
  execute: async (actionContext: unknown) => {
    try {
      const workItemIds = getSelectedWorkItemIds(actionContext);
      if (workItemIds.length === 0) {
        throw new Error('No selected work item IDs were supplied by Azure DevOps.');
      }

      const commitHash = getCommitHash();
      setStatus(`Queueing for ${workItemIds.length} work items...`);
      await queuePipeline(workItemIds, commitHash);
      await SDK.notifyLoadSucceeded();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Unable to queue pipeline: ${message}`);
      await SDK.notifyLoadFailed(message);
    }
  }
}));

SDK.init();
