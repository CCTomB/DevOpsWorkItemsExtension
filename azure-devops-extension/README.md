# Author
Tom barker
# Bulk Assign Commit Hash Azure DevOps Extension

This extension adds **Link selected work items to this commit** to the Azure Boards work-item context menu. It queues the `BulkAssignCommitHashToManyWorkItems` YAML pipeline with the selected IDs in the existing `workItemId` parameter.

## Prerequisites

- The YAML pipeline in the repository must be created and named `BulkAssignCommitHashToManyWorkItems`.
- The pipeline must accept the existing `workItemId` string parameter.
- The installing user needs permission to queue the pipeline and the extension requests `vso.build_execute` and `vso.work`.

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
