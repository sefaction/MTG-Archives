using System.Text.Json;

namespace Mtg.Scanner;

// Operational no-feed check of the real helper/backend/companion path.
// There is no Start call, website connection, authorization or spool here.
internal static class ScannerCountedPreparation
{
    internal static async Task<bool> Run(string[] args)
    {
        if (args.Length == 0 || args[0] != "counted-prepare") return false;
        if (args.Length != 2) throw new ArgumentException("counted-prepare <request.json>; hopper and transport must be empty and clear");
        var request = JsonSerializer.Deserialize<ScanRequest>(File.ReadAllText(args[1]), RunSpool.Json)
            ?? throw new ArgumentException("Missing counted preparation request");
        using var backend = new CountedTwainBackend(requireEmpty: true);
        await backend.Prepare(request);
        Console.WriteLine(JsonSerializer.Serialize(new { kind = "CountedPreparationReadbacks", proof = backend.PreparationEvidence }, RunSpool.Json));
        backend.Close();
        Console.WriteLine(JsonSerializer.Serialize(new { kind = "CountedPreparationPassed", profileVersion = CountedTwainBackend.ProfileVersion,
            target = request.SessionPhysicalTarget, acquisitionEnables = 0, images = 0,
            restoredSettings = 12, sourceClosed = true, dsmClosed = true, ownedLoopJoined = true, workerExit = 0,
            closure = backend.CloseEvidence }, RunSpool.Json));
        return true;
    }
}
