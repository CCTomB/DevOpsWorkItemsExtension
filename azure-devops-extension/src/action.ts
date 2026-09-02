import * as SDK from 'azure-devops-extension-sdk';
import { CommonServiceIds, IHostPageLayoutService } from 'azure-devops-extension-api/Common/CommonServices';

const pipelineName = 'BulkAssignCommitHashToManyWorkItems';
const statusElement = document.getElementById('status');
const pipelineRequestTimeoutMs = 30000;

function setStatus(message: string): void {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

async function showMessage(message: string): Promise<void> {
  const layoutService = await SDK.getService<IHostPageLayoutService>(CommonServiceIds.HostPageLayoutService);
  layoutService.openMessageDialog(message, { title: 'Bulk Assign Commit Hash' });
}

async function reportFailure(message: string): Promise<void> {
  console.error('Bulk Assign Commit Hash action failed:', message);
  setStatus(`Unable to queue pipeline: ${message}`);

  try {
    await showMessage(`Unable to queue pipeline:\n\n${message}`);
  } catch (dialogError: unknown) {
    console.error('Bulk Assign Commit Hash could not open the Azure DevOps message dialog:', dialogError);
  }
}

async function withTimeout<T>(operation: Promise<T>, description: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${description} did not respond within 30 seconds.`)), pipelineRequestTimeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function getAzureDevOpsJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const accessToken = await withTimeout(SDK.getAccessToken(), 'Azure DevOps access-token request');
  const response = await withTimeout(fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  }), 'Azure DevOps REST request');

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Azure DevOps REST request failed (${response.status} ${response.statusText}): ${responseText || 'no response body'}`);
  }

  return JSON.parse(responseText) as T;
}

function getAzureDevOpsBaseUri(): string {
  const referrer = document.referrer;
  if (!referrer) {
    throw new Error('Azure DevOps host URL was not provided to the extension.');
  }

  const referrerUrl = new URL(referrer);
  const host = SDK.getHost();

  if (referrerUrl.hostname === 'dev.azure.com') {
    const organization = referrerUrl.pathname.split('/').filter(Boolean)[0] ?? host.name;
    return `${referrerUrl.origin}/${encodeURIComponent(organization)}`;
  }

  return referrerUrl.origin;
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

  const workItemIds = [...new Set(candidates.flatMap(collectIds))];
  console.info('Bulk Assign Commit Hash action context', actionContext);
  console.info('Bulk Assign Commit Hash selected work item IDs', workItemIds);
  return workItemIds;
}

interface LinkDetails {
  commitHash: string;
  repositoryName: string;
  repositoryProjectName: string;
}

function getLinkDetails(): Promise<LinkDetails> {
  return new Promise<LinkDetails>((resolve, reject) => {
    SDK.getService<IHostPageLayoutService>(CommonServiceIds.HostPageLayoutService).then((dialogService) => {
      const extensionContext = SDK.getExtensionContext();
      const contributionId = `${extensionContext.id}.bulk-assign-commit-hash-dialog`;
      console.info('Opening bulk assign commit dialog contribution', contributionId);
      dialogService.openCustomDialog<LinkDetails>(contributionId, {
        title: 'Link work items to a commit',
        lightDismiss: false,
        onClose: (result) => result ? resolve(result) : reject(new Error('Commit link entry was cancelled.'))
      });
    }).catch(reject);
  });
}

async function queuePipeline(workItemIds: number[], commitHash: string, repositoryName: string, repositoryProjectName: string, workItemProjectId: string): Promise<void> {
  const webContext = SDK.getWebContext();
  const pipelineProjectName = 'Team CAT - Custom Apps';
  const clickedProjectId = workItemProjectId || webContext.project?.id;
  if (!clickedProjectId) {
    throw new Error('The current Azure DevOps project could not be determined.');
  }

  console.info('Bulk Assign Commit Hash queue request', { clickedProjectId, pipelineProjectName, pipelineName, workItemIds, commitHash, repositoryName, repositoryProjectName });
  const hostUri = getAzureDevOpsBaseUri().replace(/\/$/, '');
  const pipelinesUrl = `${hostUri}/${encodeURIComponent(pipelineProjectName)}/_apis/pipelines?api-version=7.1-preview.1`;
  console.info('Bulk Assign Commit Hash listing pipelines', pipelinesUrl);
  const pipelineResponse = await getAzureDevOpsJson<{ value: Array<{ id?: number; name?: string }> }>(pipelinesUrl);
  const pipelines = pipelineResponse.value ?? [];
  console.info('Bulk Assign Commit Hash pipeline listing completed', { count: pipelines.length });
  const pipeline = pipelines.find((candidate) => candidate.name === pipelineName);
  console.info('Bulk Assign Commit Hash pipelines found', pipelines.map((candidate) => ({ id: candidate.id, name: candidate.name })));

  if (!pipeline?.id) {
    throw new Error(`Pipeline '${pipelineName}' was not found in project '${pipelineProjectName}'.`);
  }

  console.info('Bulk Assign Commit Hash found pipeline', { id: pipeline.id, name: pipeline.name });
  const runUrl = `${hostUri}/${encodeURIComponent(pipelineProjectName)}/_apis/pipelines/${pipeline.id}/runs?api-version=7.1-preview.1`;
  const queuedRun = await getAzureDevOpsJson<{ id?: number }>(runUrl, {
    method: 'POST',
    body: JSON.stringify({
      resources: {
        repositories: {}
      },
      templateParameters: {
        workItemId: workItemIds.join(','),
        commitHash,
        repositoryName,
        repositoryProjectName,
        workItemProjectId: clickedProjectId
      },
      variables: {}
    })
  });
  console.info('Bulk Assign Commit Hash pipeline run created', queuedRun);

  const runId = queuedRun.id ? ` (run ${queuedRun.id})` : '';
  setStatus(`Queued ${pipelineName} for ${workItemIds.length} work items${runId}.`);
  await showMessage(`Pipeline queued successfully${runId}.`);
}

SDK.init();

SDK.register('bulk-assign-commit-hash-action', () => ({
  execute: async (actionContext: unknown) => {
    try {
      const workItemIds = getSelectedWorkItemIds(actionContext);
      if (workItemIds.length === 0) {
        throw new Error('No selected work item IDs were supplied by Azure DevOps.');
      }

      const { commitHash, repositoryName, repositoryProjectName } = await getLinkDetails();
      setStatus(`Queueing for ${workItemIds.length} work items...`);
      await queuePipeline(workItemIds, commitHash, repositoryName, repositoryProjectName, SDK.getWebContext().project?.id ?? '');
      await SDK.notifyLoadSucceeded();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await reportFailure(message);
      await SDK.notifyLoadFailed(message);
    }
  }
}));
