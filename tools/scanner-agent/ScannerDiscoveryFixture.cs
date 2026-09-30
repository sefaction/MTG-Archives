using NAPS2.Scan;

namespace Mtg.Scanner;

// Explicit localhost-only diagnostic fixture. Uses the real discovery adapter
// with fake driver delegates; it cannot poll START, acquire images or use USB.
internal static class ScannerDiscoveryFixture
{
    public static IScannerBackend Create(string mode)
    {
        if (mode is not ("partial" or "all" or "setup")) throw new ArgumentException("Choose partial, all or setup discovery fixture");
        return new Naps2Backend(null, driver => mode == "all" || driver == Driver.Twain
            ? throw new IOException("PRIVATE fixture driver path")
            : Task.FromResult(new List<ScanDevice> { new(Driver.Wia, "fixture-discovery", "Local discovery fixture (no scanner)") }),
            () => { if (mode == "setup") throw new IOException("PRIVATE fixture worker setup"); });
    }
}
