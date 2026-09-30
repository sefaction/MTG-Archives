using NAPS2.Scan;

namespace Mtg.Scanner;

internal static class ScannerDiagnosticSelfTest
{
    public static async Task Run()
    {
        var source = new ScanDevice(Driver.Twain, "fixture-diagnostic", "Fixture diagnostic");
        var queries = 0;
        using var backend = new Naps2Backend("Twain:fixture-diagnostic", _ => {
            queries++; return Task.FromResult(new List<ScanDevice> { source });
        }, () => { });
        using var log = new StringWriter();
        try { backend.ConfigureDiagnostic("invalid", log); throw new InvalidDataException("Unknown mode accepted"); }
        catch (ArgumentException) { }
        if (queries != 0) throw new InvalidDataException("Invalid diagnostic touched discovery");
        foreach (var mode in new[] { "default", "memory", "native", "native-old-dsm", "driver-ui" })
            backend.ConfigureDiagnostic(mode, log);
        await backend.ListDevices();
        await backend.Prepare(new(Guid.NewGuid(), "Twain:fixture-diagnostic", 600));
        try { backend.ConfigureDiagnostic("native", log); throw new InvalidDataException("Prepared settings changed"); }
        catch (InvalidOperationException) { }
        backend.Close();
        VerifyPrivateErrorBoundary(source);
        Console.WriteLine("PASS diagnostic modes reject unknown input before discovery and cannot change prepared settings; no hardware/motor");
    }
    private static void VerifyPrivateErrorBoundary(ScanDevice source)
    {
        const string outer = "PRIVATE_DRIVER_CONTEXT_7e3658";
        const string inner = "PRIVATE_DRIVER_PATH_426c68";
        var error = new InvalidOperationException(outer, new IOException(inner));
        var root = Path.Combine(Path.GetTempPath(), "MtgScannerDiagnostic-" + Guid.NewGuid());
        var folders = new List<string>();
        try
        {
            foreach (var mode in new[] { "default", "private", "closed-private", "failed-private" })
            {
                using var backend = new Naps2Backend("Twain:fixture-diagnostic", _ =>
                    Task.FromResult(new List<ScanDevice> { source }), () => { });
                using TextWriter privateLog = mode == "failed-private" ? new FailedPrivateWriter() : new StringWriter();
                if (mode != "default") backend.ConfigureDiagnostic("default", privateLog);
                if (mode == "closed-private") privateLog.Dispose();
                var request = new ScanRequest(Guid.NewGuid(), "Twain:fixture-diagnostic", 600);
                string folder;
                using (var spool = new RunSpool(root, request, new { fixture = true }))
                {
                    folder = spool.DirectoryPath;
                    folders.Add(folder);
                    backend.RecordScanError(spool, error);
                }
                var journal = File.ReadAllText(Path.Combine(folder, "events.jsonl"));
                if (journal.Contains(outer) || journal.Contains(inner) || !journal.Contains("ScannerError"))
                    throw new InvalidDataException("Driver context leaked or safe error journal was lost");
                if (mode == "private" && (!privateLog.ToString().Contains(outer) || !privateLog.ToString().Contains(inner)))
                    throw new InvalidDataException("Explicit private log lost exact driver exception context");
                if (mode == "default" && Directory.GetFiles(folder).Length != 3)
                    throw new InvalidDataException("Default run created an unexpected diagnostic file");
            }
        }
        finally
        {
            // Delete only named files in this test's owned folders, without recursion.
            foreach (var folder in folders)
            {
                foreach (var name in new[] { "events.jsonl", "run.json", "run.lock" })
                    File.Delete(Path.Combine(folder, name));
                Directory.Delete(folder);
            }
            if (Directory.Exists(root)) Directory.Delete(root);
        }
        Console.WriteLine("PASS exact driver context is opt-in/private; default export stays sanitized and closed/failed private sinks preserve error journal; no hardware/motor");
    }
    private sealed class FailedPrivateWriter : TextWriter
    {
        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;
        public override void WriteLine(string? value) => throw new IOException("Simulated diagnostic disk failure");
    }
}
