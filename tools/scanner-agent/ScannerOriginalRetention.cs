using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Mtg.Scanner;

// The server alone decides when its committed original has passed the existing
// seven-day retention purge. This bounded sweep never constructs a scanner.
public static class ScannerOriginalRetention
{
    private record OriginalReceipt(Guid ArtifactId, Guid PhotoId, string Digest);
    public static async Task<int> Check(HttpClient client, string token, string root, Guid agentId)
    {
        var runsRoot = Path.Combine(root, agentId.ToString(), "runs");
        if (!Directory.Exists(runsRoot)) return 0;
        var directories = Directory.EnumerateDirectories(runsRoot).Where(d =>
            Guid.TryParseExact(Path.GetFileName(d), "D", out _) &&
            Directory.EnumerateFiles(d, "*.png").Any()).OrderBy(d => {
                var marker = Path.Combine(d, "retention.checked");
                return File.Exists(marker) ? File.GetLastWriteTimeUtc(marker) : DateTime.MinValue;
            }).ThenBy(d => d).Take(25).ToArray();
        if (directories.Length == 0) return 0;
        var removed = 0;
        foreach (var directory in directories)
        {
            try {
            // Incomplete/orphaned spools stay untouched for operator recovery.
            if (!File.Exists(Path.Combine(directory, "binding.json")) ||
                !Directory.EnumerateFiles(directory, "*.png").Any() ||
                Directory.EnumerateFiles(directory, "*.pending.png").Any()) continue;
            var binding = JsonSerializer.Deserialize<NativeBinding>(
                await File.ReadAllTextAsync(Path.Combine(directory, "binding.json")), RunSpool.Json)
                ?? throw new InvalidDataException("Scanner retention binding unavailable");
            if (binding.Instruction.RunId.ToString() != Path.GetFileName(directory) ||
                binding.Instruction.Version != 1 || binding.Instruction.Epoch == Guid.Empty)
                throw new InvalidDataException("Scanner retention binding changed");
            var artifacts = ScannerNativeRunner.Artifacts(directory);
            if (Directory.EnumerateFiles(directory, "*.png").Any(file =>
                !artifacts.Any(a => a.FileName == Path.GetFileName(file))))
                throw new InvalidDataException("Scanner retention has an unjournaled original");
            var eligibleToAsk = new List<OriginalReceipt>();
            var locallyVerified = new Dictionary<Guid, ScannerArtifact>();
            foreach (var artifact in artifacts.Where(a => File.Exists(Path.Combine(directory, a.FileName))))
            {
                var receipt = Path.Combine(directory, $"{artifact.Id}.receipt.json");
                if (!File.Exists(receipt)) continue;
                var ack = JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(receipt));
                if (ack.GetProperty("version").GetInt32() != 1 ||
                    ack.GetProperty("runId").GetGuid() != binding.Instruction.RunId ||
                    ack.GetProperty("artifactId").GetGuid() != artifact.Id ||
                    ack.GetProperty("sequence").GetInt32() != artifact.Sequence ||
                    ack.GetProperty("digest").GetString() != artifact.Sha256 ||
                    !ack.GetProperty("ready").GetBoolean())
                    throw new InvalidDataException("Scanner retention receipt changed");
                var photoId = ack.GetProperty("photoId").GetGuid();
                if (photoId == Guid.Empty) throw new InvalidDataException("Scanner retention photo identity unavailable");
                eligibleToAsk.Add(new OriginalReceipt(artifact.Id, photoId, artifact.Sha256));
                locallyVerified.Add(artifact.Id, artifact);
            }
            foreach (var group in eligibleToAsk.Chunk(500))
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, "api/scanner-agent/retention") {
                    Content = JsonContent.Create(new { version = 1, runId = binding.Instruction.RunId,
                        epoch = binding.Instruction.Epoch, artifacts = group }, options: RunSpool.Json) };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var response = await client.SendAsync(request);
                if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Scanner retention unavailable; originals retained");
                var result = await response.Content.ReadFromJsonAsync<JsonElement>();
                if (result.GetProperty("version").GetInt32() != 1 ||
                    result.GetProperty("runId").GetGuid() != binding.Instruction.RunId ||
                    result.GetProperty("epoch").GetGuid() != binding.Instruction.Epoch)
                    throw new InvalidDataException("Scanner retention acknowledgement changed");
                var granted = new HashSet<Guid>();
                foreach (var id in result.GetProperty("eligible").EnumerateArray().Select(e => e.GetGuid()))
                {
                    if (!granted.Add(id) || !locallyVerified.TryGetValue(id, out var artifact) ||
                        !group.Any(item => item.ArtifactId == id))
                        throw new InvalidDataException("Scanner retention granted an unknown artifact");
                    var file = Path.Combine(directory, artifact.FileName);
                    var info = new FileInfo(file);
                    if (!info.Exists) continue;
                    if (info.LinkTarget != null || info.Length != artifact.Bytes ||
                        info.Length > 10L * 1024 * 1024)
                        throw new InvalidDataException("Scanner original changed; retained");
                    await using (var stream = File.OpenRead(file)) {
                        if (Convert.ToHexString(await SHA256.HashDataAsync(stream)).ToLowerInvariant() != artifact.Sha256)
                            throw new InvalidDataException("Scanner original digest changed; retained");
                    }
                    File.Delete(file);
                    removed++;
                }
            }
            } catch (Exception error) when (error is InvalidDataException or IOException or InvalidOperationException or
                JsonException or HttpRequestException or KeyNotFoundException) {
                Console.WriteLine("Scanner spool retention skipped an unresolved run; originals retained.");
            } finally {
                // A scheduling hint only. Old uncommitted runs must not starve
                // later eligible runs, including after helper restarts.
                try { File.WriteAllText(Path.Combine(directory, "retention.checked"), DateTime.UtcNow.ToString("O")); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            }
        }
        return removed;
    }
}
