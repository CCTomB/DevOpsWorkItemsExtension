import * as SDK from 'azure-devops-extension-sdk';

interface LinkDetails {
  commitHash: string;
  repositoryName: string;
  repositoryProjectName: string;
}

const commitHashInput = document.getElementById('commit-hash') as HTMLInputElement | null;
const repositoryNameInput = document.getElementById('repository-name') as HTMLInputElement | null;
const repositoryProjectNameInput = document.getElementById('repository-project-name') as HTMLInputElement | null;
const cancelButton = document.getElementById('cancel-link') as HTMLButtonElement | null;
const continueButton = document.getElementById('continue-link') as HTMLButtonElement | null;

function closeDialog(result?: LinkDetails): void {
  const configuration = SDK.getConfiguration() as { dialog?: { close: (value?: LinkDetails) => void } };
  configuration.dialog?.close(result);
}

continueButton?.addEventListener('click', () => {
  if (!commitHashInput || !repositoryNameInput || !repositoryProjectNameInput ||
      !commitHashInput.reportValidity() || !repositoryNameInput.reportValidity() || !repositoryProjectNameInput.reportValidity()) {
    return;
  }

  closeDialog({
    commitHash: commitHashInput.value.trim(),
    repositoryName: repositoryNameInput.value.trim(),
    repositoryProjectName: repositoryProjectNameInput.value.trim()
  });
});

cancelButton?.addEventListener('click', () => closeDialog());

SDK.init();
SDK.ready().then(() => {
  console.info('Bulk Assign Commit Hash dialog content loaded');
  commitHashInput?.focus();
  return SDK.notifyLoadSucceeded();
});
