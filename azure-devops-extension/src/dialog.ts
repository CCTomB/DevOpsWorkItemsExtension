import * as SDK from 'azure-devops-extension-sdk';

interface LinkDetails {
  commitHash: string;
  repositoryName: string;
  repositoryProjectName: string;
}

const form = document.getElementById('link-form') as HTMLFormElement | null;
const commitHashInput = document.getElementById('commit-hash') as HTMLInputElement | null;
const repositoryNameInput = document.getElementById('repository-name') as HTMLInputElement | null;
const repositoryProjectNameInput = document.getElementById('repository-project-name') as HTMLInputElement | null;
const cancelButton = document.getElementById('cancel-link') as HTMLButtonElement | null;

function closeDialog(result?: LinkDetails): void {
  const configuration = SDK.getConfiguration() as { dialog?: { close: (value?: LinkDetails) => void } };
  configuration.dialog?.close(result);
}

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity() || !commitHashInput || !repositoryNameInput || !repositoryProjectNameInput) {
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
SDK.ready().then(() => commitHashInput?.focus());
