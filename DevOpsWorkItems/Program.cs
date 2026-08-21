using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.TeamFoundation.WorkItemTracking.WebApi;
using Microsoft.TeamFoundation.WorkItemTracking.WebApi.Models;
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
        string repositoryId = Environment.GetEnvironmentVariable("REPOSITORY_ID") ?? "c3298fea-1057-4166-a52d-e55b54529d17";
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

        VssCredentials credentials = !string.IsNullOrWhiteSpace(systemAccessToken)
            ? new VssOAuthAccessTokenCredential(systemAccessToken)
            : new VssBasicCredential(string.Empty, personalAccessToken);
        using var connection = new VssConnection(new Uri(organizationUrl), credentials);
        var workItemClient = connection.GetClient<WorkItemTrackingHttpClient>();

        // vstfs artifact URL
        string artifactUrl = $"vstfs:///Git/Commit/{projectId}/{repositoryId}/{commitHash}";

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

                var patchDocument = new JsonPatchDocument();
                patchDocument.Add(new JsonPatchOperation
                {
                    Operation = Operation.Add,
                    Path = "/relations/-",
                    Value = new
                    {
                        rel = "ArtifactLink",
                        url = artifactUrl,
                        attributes = new
                        {
                            name = "Fixed in Commit"
                        }
                    }
                });

                await workItemClient.UpdateWorkItemAsync(patchDocument, workItemId);
                Console.WriteLine($"✓ Work Item {workItemId} linked successfully.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ Work Item {workItemId} failed: {ex.Message}");
            }
        }

        Console.WriteLine("Done.");
        return 0;
    }
}