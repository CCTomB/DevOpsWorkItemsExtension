# Author
Tom barker
# Bulk Assign Commit Hash Azure DevOps Extension

This extension adds **Link selected work items to this commit** to the Azure Boards work-item context menu. It asks for a Git commit hash and Azure Repos repository name, then queues the `BulkAssignCommitHashToManyWorkItems` YAML pipeline with the selected IDs and values.

## Prerequisites

- The YAML pipeline in the repository must be created and named `BulkAssignCommitHashToManyWorkItems`.
- The pipeline must accept the existing `workItemId` string parameter.
- The pipeline must accept the `commitHash` string parameter.
- The pipeline accepts `repositoryName` and `repositoryProjectName` parameters. Enter the Azure Repos repository name and the project name containing that repository; this project can differ from the project containing the selected work items and pipeline.
- The installing user needs permission to queue the pipeline and the extension requests `vso.build_execute` and `vso.work`.

The pipeline uses Azure Pipelines `System.AccessToken` by default. Grant the pipeline build service identity permission to read and edit work items, and permission to read the repository. A `PERSONAL_ACCESS_TOKEN` secret variable remains supported as a fallback for local or restricted pipeline environments.

## Build

```powershell
npm install
npm run typecheck
npm run build
```

To create a Marketplace package, replace `YOUR_PUBLISHER_ID` in `vss-extension.json`, then run:

```powershell
npm run package
```

Install the resulting `.vsix` in a test Azure DevOps organization first. The work-item context payload is host-provided; if a particular Azure DevOps experience exposes a different property name, update `getSelectedWorkItemIds` in `src/action.ts`.
