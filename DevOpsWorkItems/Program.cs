using Microsoft.TeamFoundation.Core.WebApi;
using Microsoft.TeamFoundation.WorkItemTracking.WebApi;
using Microsoft.TeamFoundation.WorkItemTracking.WebApi.Models;
using Microsoft.VisualStudio.Services.Common;
using Microsoft.VisualStudio.Services.WebApi;
using Microsoft.VisualStudio.Services.WebApi.Patch;
using Microsoft.VisualStudio.Services.WebApi.Patch.Json;

// --- Configuration ---
string organizationUrl = "https://dev.azure.com/cornwallcouncil/";
string personalAccessToken = "1gYQwdqKWAIp4uPqJ6xbruFStN7Ue7QA8blk0IypgU82QAM28eKXJQQJ99CHACAAAAAxQP9BAAASAZDO3Lp0";
string projectId = "df2fa711-4f06-46a2-8d30-6b01e5fa8549";
string repositoryId = "c3298fea-1057-4166-a52d-e55b54529d17";
string commitHash = "59973bc39dcab4557cb64c47d9947eadfe7f6774";
int[] workItemIds = { 192440, 192441, 192442, 192443, 192444, 192445, 192446, 192447, 192448, 192450, 192451, 192452, 192453, 192454, 192455, 192456, 192457, 192458, 192459, 192460 }; // Add all your IDs here

// --- Setup Connection ---
var credentials = new VssBasicCredential(string.Empty, personalAccessToken);
using var connection = new VssConnection(new Uri(organizationUrl), credentials);
var workItemClient = connection.GetClient<WorkItemTrackingHttpClient>();

// --- Construct the vstfs URL (plain slashes for creating links) ---
string artifactUrl = $"vstfs:///Git/Commit/{projectId}/{repositoryId}/{commitHash}";

Console.WriteLine($"Linking commit to {workItemIds.Length} work items...");

foreach (int workItemId in workItemIds)
{
    try
    {
        // Fetch existing work item relations
        var existingItem = await workItemClient.GetWorkItemAsync(workItemId, expand: WorkItemExpand.Relations);

        bool relationExists = existingItem.Relations != null &&
                              existingItem.Relations.Any(r =>
                                  string.Equals(r.Url, artifactUrl, StringComparison.OrdinalIgnoreCase) ||
                                  (r.Rel?.Equals("ArtifactLink", StringComparison.OrdinalIgnoreCase) == true &&
                                   r.Url != null && r.Url.IndexOf(commitHash, StringComparison.OrdinalIgnoreCase) >= 0)
                              );

        if (relationExists)
        {
            Console.WriteLine($"→ Work Item {workItemId}: relation already exists, skipping.");
            continue;
        }

        // Create the JSON Patch document using the official SDK types
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

        // Update the work item
        var updatedItem = await workItemClient.UpdateWorkItemAsync(patchDocument, workItemId);
        Console.WriteLine($"✓ Work Item {workItemId} linked successfully.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"✗ Work Item {workItemId} failed: {ex.Message}");
    }
}

Console.WriteLine("Done.");
