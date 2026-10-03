namespace Mtg.Scanner;

// Exercises the actual companion channel/image spool with an explicit fake
// companion mode. That mode branches before any TWAIN session is constructed.
internal static class ScannerCountedSelfTest
{
    public static async Task Run(string fixtureRoot)
    {
        var request = new ScanRequest(Guid.NewGuid(), CountedTwainBackend.DeviceId, 600, 2.7m, 3.6m,
            SessionPhysicalTarget: 2);
        using (var suspended = new CountedTwainBackend())
        {
            if ((await suspended.ListDevices()).Single().Qualification != Qualification.Unsupported ||
                (await suspended.GetCapabilities(CountedTwainBackend.DeviceId)).Features["countControl"].Support != Support.ReportedUnsupported)
                throw new InvalidDataException("Failed physical count control still advertised as working");
            var refused = false;
            try { await suspended.Prepare(request); }
            catch (InvalidOperationException error) when (error.Message == CountedTwainBackend.SuspendedReason) { refused = true; }
            if (!refused) throw new InvalidDataException("Suspended counted source reached native preparation");
        }
        foreach (var invalid in new[] { request with { Dpi = 300 }, request with { Duplex = true },
            request with { SessionPhysicalTarget = null }, request with { ImageStopBudget = 1 },
            request with { WidthInches = 2.6m }, request with { AllowInterruptingStop = true } })
        {
            var denied = false;
            try { CountedTwainBackend.Validate(invalid); } catch (InvalidOperationException) { denied = true; }
            if (!denied) throw new InvalidDataException("Invalid counted request accepted");
        }
        var root = Path.Combine(Path.GetFullPath(fixtureRoot), Guid.NewGuid().ToString());
        Directory.CreateDirectory(root);
        try
        {
            foreach (var scenario in new[] { "normal", "early-empty", "overtransfer", "restore-error" })
            {
                var run = request with { RunId = Guid.NewGuid() };
                using var backend = new CountedTwainBackend(scenario);
                await backend.Prepare(run);
                using var spool = new RunSpool(root, run, new { fixture = true, hardware = false });
                RunSpool.WriteNew(Path.Combine(spool.DirectoryPath, "binding.json"), new { fixture = true });
                await backend.Start(spool);
                var artifacts = ScannerNativeRunner.Artifacts(spool.DirectoryPath);
                var expected = scenario == "early-empty" ? 1 : scenario == "overtransfer" ? 3 : 2;
                if (artifacts.Count != expected || artifacts.Where((a,i)=>a.Sequence!=i+1).Any())
                    throw new InvalidDataException("Counted companion discarded or reordered a transfer");
                using var journalStream = new FileStream(Path.Combine(spool.DirectoryPath, "events.jsonl"), FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                using var journalReader = new StreamReader(journalStream);
                var journal = journalReader.ReadToEnd();
                if (scenario is "overtransfer" or "restore-error" && !journal.Contains("\"outcome\":\"ERROR\""))
                    throw new InvalidDataException("Counted error was hidden");
                if (scenario == "early-empty" && !journal.Contains("REPORTED_EMPTY"))
                    throw new InvalidDataException("Early-empty evidence missing");
                var denied = false;
                try { await backend.Start(spool); } catch (InvalidOperationException) { denied = true; }
                if (!denied) throw new InvalidDataException("Same counted backend fed twice");
            }
            Console.WriteLine("PASS suspended physical count source refused before native preparation; motor-free counted channel, invalid profile, early-empty/restore-error/retained-overtransfer and single Start");
        }
        finally { Directory.Delete(root, true); }
    }
}
