import * as SDK from 'azure-devops-extension-sdk';

interface LinkDetails {
  commitHash: string;
  repositoryName: string;
  repositoryProjectName: string;
}

const commitHashInput = document.getElementById('commit-hash') as HTMLInputElement;
const repositoryNameInput = document.getElementById('repository-name') as HTMLInputElement;
const repositoryProjectNameInput = document.getElementById('repository-project-name') as HTMLInputElement;
const cancelButton = document.getElementById('cancel-link') as HTMLButtonElement;
const continueButton = document.getElementById('continue-link') as HTMLButtonElement;

function closeDialog(result?: LinkDetails): void {
  const configuration = SDK.getConfiguration() as { dialog?: { close: (value?: LinkDetails) => void } };
  configuration.dialog?.close(result);
}

continueButton.addEventListener('click', () => {
  if (!commitHashInput.reportValidity() || !repositoryNameInput.reportValidity() || !repositoryProjectNameInput.reportValidity()) {
    return;
  }

  closeDialog({
    commitHash: commitHashInput.value.trim(),
    repositoryName: repositoryNameInput.value.trim(),
    repositoryProjectName: repositoryProjectNameInput.value.trim()
  });
});

cancelButton.addEventListener('click', () => closeDialog());

SDK.init();
SDK.ready().then(() => {
  const configuration = SDK.getConfiguration() as { dialog?: unknown };
  if (configuration.dialog) {
    SDK.resize(520, 360);
  }

  commitHashInput.focus();
  console.info('Bulk Assign Commit Hash dialog content loaded');
  return SDK.notifyLoadSucceeded();
});
