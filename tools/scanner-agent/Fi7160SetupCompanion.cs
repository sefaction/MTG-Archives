using System.Diagnostics;
using System.Text.Json;

namespace Mtg.Scanner;

internal static class Fi7160SetupCompanion
{
    internal static async Task Configure()
    {
        var start = new ProcessStartInfo(CountedTwainBackend.WorkerPath) { UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true };
        start.ArgumentList.Add("setup-profile-v1");
        using var child = Process.Start(start) ?? throw new InvalidOperationException("The counted scanner companion is missing. Reinstall the helper.");
        await child.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { action = "configure-settings-only", parent = Environment.ProcessId, emptyClearConfirmed = true }));
        child.StandardInput.Close(); // No Start command can ever be sent here.
        JsonElement? proof = null;
        while (await child.StandardOutput.ReadLineAsync() is string line)
        {
            if (line.Length > 16384) throw new InvalidDataException("Unexpected settings response. Close the driver settings window.");
            var message = JsonSerializer.Deserialize<JsonElement>(line);
            if (message.GetProperty("kind").GetString() == "settings-completed") proof = message;
        }
        await child.WaitForExitAsync();
        if (proof == null || child.ExitCode != 0) throw new InvalidOperationException("Connect and power on the fi-7160, leave the hopper and transport empty, then retry. In driver settings select MTG Cards 600 DPI, confirm Pre-Pick Off, and save with OK. Setup did not verify the effective settings.");
        RequireProof(proof.Value);
    }
    internal static void RequireProof(JsonElement proof)
    {
        if (!proof.TryGetProperty("verified", out var verified) || verified.ValueKind != JsonValueKind.True ||
            !proof.TryGetProperty("sourceClosed", out var source) || source.ValueKind != JsonValueKind.True ||
            !proof.TryGetProperty("dsmClosed", out var dsm) || dsm.ValueKind != JsonValueKind.True ||
            !proof.TryGetProperty("ownedLoopJoined", out var loop) || loop.ValueKind != JsonValueKind.True ||
            !proof.TryGetProperty("acquisitionEnables", out var enables) || !enables.TryGetInt32(out var count) || count != 0)
            throw new InvalidDataException("Driver settings closure/readback was not verified. Close its window and retry setup.");
    }
}
