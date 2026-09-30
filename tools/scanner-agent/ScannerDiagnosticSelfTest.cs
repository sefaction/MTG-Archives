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
        Console.WriteLine("PASS diagnostic modes reject unknown input before discovery and cannot change prepared settings; no hardware/motor");
    }
}
