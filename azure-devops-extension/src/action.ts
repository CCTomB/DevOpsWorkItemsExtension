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

function getSelectedWorkItemIds(): number[] {
  const configuration = SDK.getConfiguration() as Record<string, unknown>;
  const candidates = [
    configuration.witInputs,
    configuration.workItemIds,
    configuration.selectedWorkItemIds,
    configuration
  ];

  return [...new Set(candidates.flatMap(collectIds))];
}

async function queuePipeline(workItemIds: number[]): Promise<void> {
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
      workItemId: workItemIds.join(',')
    }
  } as unknown as Build, projectId, undefined, undefined, undefined, definition.id);

  const buildNumber = queuedBuild.buildNumber ?? String(queuedBuild.id ?? '');
  setStatus(`Queued ${pipelineName} for ${workItemIds.length} work items${buildNumber ? ` (run ${buildNumber})` : ''}.`);
}

async function main(): Promise<void> {
  await SDK.init();
  await SDK.ready();

  const workItemIds = getSelectedWorkItemIds();
  if (workItemIds.length === 0) {
    throw new Error('No selected work item IDs were supplied by Azure DevOps. Select multiple work items and try again.');
  }

  setStatus(`Queueing for ${workItemIds.length} work items...`);
  await queuePipeline(workItemIds);
  await SDK.notifyLoadSucceeded();
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`Unable to queue pipeline: ${message}`);
  await SDK.notifyLoadFailed(message);
});
