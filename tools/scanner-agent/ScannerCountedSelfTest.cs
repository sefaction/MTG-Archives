namespace Mtg.Scanner;

// Exercises the actual companion channel/image spool with an explicit fake
// companion mode. That mode branches before any TWAIN session is constructed.
internal static class ScannerCountedSelfTest
{
    public static async Task Run(string fixtureRoot)
    {
        var request = new ScanRequest(Guid.NewGuid(), CountedTwainBackend.DeviceId, 600, 2.7m, 3.6m,
            SessionPhysicalTarget: 2);
        var nativeStart = new System.Diagnostics.ProcessStartInfo(CountedTwainBackend.WorkerPath) {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true
        };
        nativeStart.ArgumentList.Add("helper-channel-v1");
        using (var native = System.Diagnostics.Process.Start(nativeStart)
            ?? throw new InvalidDataException("Native suspension check unavailable"))
        {
            // EOF makes a missing refusal fail safely before valid preparation;
            // no physical request or source identity is supplied by this test.
            native.StandardInput.Close();
            var refused = await native.StandardOutput.ReadToEndAsync();
            await native.WaitForExitAsync();
            using var response = System.Text.Json.JsonDocument.Parse(refused);
            if (native.ExitCode != 2 || response.RootElement.GetProperty("kind").GetString() != "problem" ||
                response.RootElement.GetProperty("code").GetString() != "COUNT_CONTROL_SUSPENDED")
                throw new InvalidDataException("Direct counted companion bypassed feeding suspension");
        }
        using (var scoped = new CountedTwainBackend())
        {
            if ((await scoped.ListDevices()).Single().Qualification != Qualification.KnownWorking ||
                (await scoped.GetCapabilities(CountedTwainBackend.DeviceId)).Features["countControl"].Support != Support.ReportedSupported)
                throw new InvalidDataException("Scoped counted source qualification unavailable");
        }
        // A stale native protocol request must fail before ownership/DSM/source
        // construction. This is a real companion process, not the fixture seam.
        nativeStart.ArgumentList.Clear();
        nativeStart.ArgumentList.Add("helper-channel-v2");
        using (var native = System.Diagnostics.Process.Start(nativeStart) ?? throw new InvalidDataException("Native v2 check unavailable"))
        {
            await native.StandardInput.WriteLineAsync(System.Text.Json.JsonSerializer.Serialize(new {
                action = "prepare", parent = Environment.ProcessId, target = 2, profileVersion = 1, requireEmpty = true }));
            native.StandardInput.Close();
            var responses = (await native.StandardOutput.ReadToEndAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries);
            await native.WaitForExitAsync();
            if (native.ExitCode != 1 || responses.Length != 2) throw new InvalidDataException("Stale native request was not refused");
            using var completion = System.Text.Json.JsonDocument.Parse(responses[1]);
            var proof = completion.RootElement;
            if (proof.GetProperty("acquisitionEnables").GetInt32() != 0 || proof.GetProperty("restoredSettings").GetInt32() != 0 ||
                proof.GetProperty("sourceClosed").GetBoolean() || proof.GetProperty("dsmClosed").GetBoolean())
                throw new InvalidDataException("Stale native request reached scanner settings");
        }
        foreach (var invalid in new[] { request with { Dpi = 300 }, request with { Duplex = true },
            request with { SessionPhysicalTarget = null }, request with { ImageStopBudget = 1 },
            request with { WidthInches = 2.6m }, request with { AllowInterruptingStop = true }, request with { RunId = Guid.Empty } })
        {
            var denied = false;
            try { CountedTwainBackend.Validate(invalid); } catch (InvalidOperationException) { denied = true; }
            if (!denied) throw new InvalidDataException("Invalid counted request accepted");
        }
        var root = Path.Combine(Path.GetFullPath(fixtureRoot), Guid.NewGuid().ToString());
        Directory.CreateDirectory(root);
        try
        {
            foreach (var scenario in new[] { "blank-discard-auto", "blank-proof-missing", "blank-proof-malformed", "old-profile",
                "wrong-driver", "wrong-source", "wrong-frame", "capture-proof-missing", "invariant-proof-missing", "invariant-proof-malformed" })
            {
                using var refusedBackend = new CountedTwainBackend(scenario);
                var refused = false;
                try { await refusedBackend.Prepare(request); }
                catch (InvalidOperationException) { refused = true; }
                if (!refused) throw new InvalidDataException($"Unsafe/unknown profile proof reached prepared state: {scenario}");
            }
            using (var empty = new CountedTwainBackend("normal", requireEmpty: true))
            {
                await empty.Prepare(request);
                var denied = false;
                try { await empty.Start(null!); } catch (InvalidOperationException) { denied = true; }
                if (!denied) throw new InvalidDataException("Empty qualification admitted Start");
                empty.Close();
            }
            using (var badClose = new CountedTwainBackend("prepare-close-error", requireEmpty: true))
            {
                await badClose.Prepare(request);
                var denied = false;
                try { badClose.Close(); } catch (InvalidDataException) { denied = true; }
                if (!denied) throw new InvalidDataException("Failed preparation restoration was reported as clean closure");
            }
            foreach (var scenario in new[] { "normal", "early-empty", "overtransfer", "restore-error", "late-exit-error", "closure-proof-missing" })
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
                if (scenario is "overtransfer" or "restore-error" or "late-exit-error" or "closure-proof-missing" && !journal.Contains("\"outcome\":\"ERROR\""))
                    throw new InvalidDataException("Counted error was hidden");
                if (scenario == "early-empty" && !journal.Contains("REPORTED_EMPTY"))
                    throw new InvalidDataException("Early-empty evidence missing");
                var denied = false;
                try { await backend.Start(spool); } catch (InvalidOperationException) { denied = true; }
                if (!denied) throw new InvalidDataException("Same counted backend fed twice");
            }
            Console.WriteLine("PASS legacy physical route refused; exact v2 driver/source/frame/readback proof required; no-feed prepare/close refuses Start; motor-free early-empty, retained-overtransfer, restoration/closure/late-exit faults and single Start");
        }
        finally { Directory.Delete(root, true); }
    }
}
