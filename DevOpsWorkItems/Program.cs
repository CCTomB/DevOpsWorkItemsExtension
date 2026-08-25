using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.TeamFoundation.WorkItemTracking.WebApi;
using Microsoft.TeamFoundation.WorkItemTracking.WebApi.Models;
using Microsoft.TeamFoundation.SourceControl.WebApi;
using Microsoft.VisualStudio.Services.Common;
using Microsoft.VisualStudio.Services.OAuth;
using Microsoft.VisualStudio.Services.WebApi;
using Microsoft.VisualStudio.Services.WebApi.Patch.Json;
using Microsoft.VisualStudio.Services.WebApi.Patch;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        // Read configuration from environment variables or args
        string organizationUrl = Environment.GetEnvironmentVariable("ORG_URL") ?? "https://dev.azure.com/yourOrg/";
        string personalAccessToken = Environment.GetEnvironmentVariable("PERSONAL_ACCESS_TOKEN") ?? "";
        string systemAccessToken = Environment.GetEnvironmentVariable("SYSTEM_ACCESSTOKEN") ?? "";
        string projectId = Environment.GetEnvironmentVariable("PROJECT_ID") ?? "df2fa711-4f06-46a2-8d30-6b01e5fa8549";
        string repositoryProjectName = Environment.GetEnvironmentVariable("REPOSITORY_PROJECT_NAME") ?? "";
        string repositoryId = Environment.GetEnvironmentVariable("REPOSITORY_ID") ?? "";
        string repositoryName = Environment.GetEnvironmentVariable("REPOSITORY_NAME") ?? "";
        string commitHash = Environment.GetEnvironmentVariable("COMMIT_HASH") ?? "";
        string workItemArg = args.FirstOrDefault(a => a.StartsWith("--workItemId="))?.Split('=')[1]
                             ?? Environment.GetEnvironmentVariable("WORK_ITEM_ID");

        if (string.IsNullOrWhiteSpace(personalAccessToken) && string.IsNullOrWhiteSpace(systemAccessToken))
        {
            Console.Error.WriteLine("No Azure DevOps token provided (set SYSTEM_ACCESSTOKEN or PERSONAL_ACCESS_TOKEN).");
            return 2;
        }

        if (string.IsNullOrWhiteSpace(workItemArg))
        {
            Console.Error.WriteLine("No work item id provided (use --workItemId=<id> or WORK_ITEM_ID env var).");
            return 2;
        }

        var workItemIds = workItemArg.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                                     .Select(s => int.Parse(s)).ToArray();

        bool usePersonalAccessToken = !string.IsNullOrWhiteSpace(personalAccessToken);
        VssCredentials credentials = usePersonalAccessToken
            ? new VssBasicCredential(string.Empty, personalAccessToken)
            : new VssOAuthAccessTokenCredential(systemAccessToken);
        Console.WriteLine($"Azure DevOps credential selected: {(usePersonalAccessToken ? "PAT" : "System.AccessToken")}");
        using var connection = new VssConnection(new Uri(organizationUrl), credentials);
        var workItemClient = connection.GetClient<WorkItemTrackingHttpClient>();

        if (string.IsNullOrWhiteSpace(repositoryName))
        {
            Console.Error.WriteLine("No repository name provided (set REPOSITORY_NAME).");
            return 2;
        }

        if (string.IsNullOrWhiteSpace(repositoryProjectName))
        {
            Console.Error.WriteLine("No repository project provided (set REPOSITORY_PROJECT_NAME to the project name or GUID containing the repository).");
            return 2;
        }

        Console.WriteLine($"Repository lookup input: project '{repositoryProjectName}', repository '{repositoryName}'.");

        var gitClient = connection.GetClient<GitHttpClient>();
        GitRepository? repository = null;
        if (Guid.TryParse(repositoryId, out var parsedRepositoryId))
        {
            try
            {
                repository = await gitClient.GetRepositoryAsync(parsedRepositoryId);
            }
            catch (VssServiceException)
            {
            }
        }

        if (repository is null)
        {
            try
            {
                repository = await gitClient.GetRepositoryAsync(repositoryProjectName, repositoryName);
            }
            catch (VssServiceException)
            {
            }
        }

        repository ??= (await gitClient.GetRepositoriesAsync(repositoryProjectName))
            .FirstOrDefault(r => string.Equals(r.Name, repositoryName, StringComparison.OrdinalIgnoreCase));

        if (repository is null || repository.Id == Guid.Empty)
        {
            Console.Error.WriteLine($"Repository '{repositoryName}' could not be resolved.");
            return 2;
        }

        Console.WriteLine($"Resolved repository '{repository.Name}' ({repository.Id}) in repository project '{repositoryProjectName}'; tasks and pipeline project is {projectId}.");

        GitCommit commit;
        try
        {
            commit = await gitClient.GetCommitAsync(repositoryProjectName, commitHash, repository.Id.ToString());
        }
        catch (VssServiceException ex)
        {
            Console.Error.WriteLine($"Commit '{commitHash}' could not be found in repository '{repository.Name}' ({repository.Id}) and repository project '{repositoryProjectName}': {ex.Message}");
            return 2;
        }

        if (string.IsNullOrWhiteSpace(commit.CommitId))
        {
            Console.Error.WriteLine($"Azure DevOps returned no canonical ID for commit '{commitHash}'.");
            return 2;
        }

        commitHash = commit.CommitId;
        Console.WriteLine($"Verified commit '{commitHash}' in repository '{repository.Name}'.");

        string artifactUrl = $"vstfs:///Git/Commit/{repositoryProjectName}/{repository.Id}/{commitHash}";
        var failedWorkItems = new List<(int Id, string Message)>();

        Console.WriteLine($"Linking commit {commitHash} to {workItemIds.Length} work items...");

        foreach (int workItemId in workItemIds)
        {
            try
            {
                var existingItem = await workItemClient.GetWorkItemAsync(workItemId, expand: WorkItemExpand.Relations);

                bool relationExists = existingItem.Relations != null &&
                    existingItem.Relations.Any(r =>
                        string.Equals(r.Url, artifactUrl, StringComparison.OrdinalIgnoreCase) ||
                        (r.Rel?.Equals("ArtifactLink", StringComparison.OrdinalIgnoreCase) == true &&
                         r.Url != null && !string.IsNullOrEmpty(commitHash) && r.Url.IndexOf(commitHash, StringComparison.OrdinalIgnoreCase) >= 0)
                    );

                if (relationExists)
                {
                    Console.WriteLine($"→ Work Item {workItemId}: relation already exists, skipping.");
                    continue;
                }

                var relation = new
                {
                    rel = "ArtifactLink",
                    url = artifactUrl,
                    attributes = new
                    {
                        name = "Fixed in Commit"
                    }
                };
                var patchDocument = new JsonPatchDocument();
                patchDocument.Add(new JsonPatchOperation
                {
                    Operation = Operation.Add,
                    Path = "/relations/-",
                    Value = relation
                });

                string workItemEndpoint = $"PATCH {organizationUrl.TrimEnd('/')}/_apis/wit/workitems/{workItemId}?api-version=7.1";
                string patchPayload = JsonSerializer.Serialize(new[]
                {
                    new
                    {
                        op = "add",
                        path = "/relations/-",
                        value = relation
                    }
                });
                Console.WriteLine($"Link request: {workItemEndpoint}");
                Console.WriteLine($"Artifact URL: {artifactUrl}");
                Console.WriteLine($"JSON patch payload: {patchPayload}");

                await workItemClient.UpdateWorkItemAsync(patchDocument, workItemId);
                var savedItem = await workItemClient.GetWorkItemAsync(workItemId, expand: WorkItemExpand.Relations);
                var savedRelation = savedItem.Relations?.FirstOrDefault(r =>
                    r.Rel?.Equals("ArtifactLink", StringComparison.OrdinalIgnoreCase) == true &&
                    string.Equals(r.Url, artifactUrl, StringComparison.OrdinalIgnoreCase));
                if (savedRelation is null)
                {
                    throw new InvalidOperationException($"PATCH succeeded, but Azure DevOps did not return the expected ArtifactLink URL. Stored ArtifactLink URLs: {string.Join(" | ", savedItem.Relations?.Where(r => r.Rel?.Equals("ArtifactLink", StringComparison.OrdinalIgnoreCase) == true).Select(r => r.Url) ?? Enumerable.Empty<string>())}");
                }

                Console.WriteLine($"Saved ArtifactLink URL: {savedRelation.Url}");
                Console.WriteLine($"✓ Work Item {workItemId} linked and verified successfully.");
            }
            catch (Exception ex)
            {
                failedWorkItems.Add((workItemId, ex.Message));
                Console.WriteLine($"✗ Work Item {workItemId} failed: {ex.Message}");
                Console.WriteLine($"##vso[task.logissue type=warning]Work Item {workItemId} failed: {ex.Message}");
            }
        }

        if (failedWorkItems.Count == 0)
        {
            Console.WriteLine("Done. All work items were linked or already had the relation.");
        }
        else
        {
            Console.WriteLine($"Done with {failedWorkItems.Count} failed work item(s):");
            foreach (var failure in failedWorkItems)
            {
                Console.WriteLine($"- Work Item {failure.Id}: {failure.Message}");
            }

            Console.WriteLine($"##vso[task.complete result=SucceededWithIssues;]Completed with {failedWorkItems.Count} failed work item(s). See the warnings above for details.");
        }

        return 0;
    }
}