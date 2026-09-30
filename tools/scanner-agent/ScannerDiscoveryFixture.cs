using NAPS2.Scan;

namespace Mtg.Scanner;

// Explicit localhost-only diagnostic fixture. Uses the real discovery adapter
// with fake driver delegates; it cannot poll START, acquire images or use USB.
internal static class ScannerDiscoveryFixture
{
    public static IScannerBackend Create(string mode)
    {
        if (mode is "pending" or "refresh") {
            var calls = 0;
            return new Naps2Backend(null, async driver => {
                if (driver == Driver.Twain) return [];
                var count = ++calls;
                Console.WriteLine($"Local discovery fixture WIA invocation {count}.");
                if (mode == "pending" && count == 1 || mode == "refresh" && count == 2) {
                    Console.WriteLine("Local discovery fixture: controlled call pending.");
                    await Task.Delay(35000); // Fixture completion, not a timeout of a native call.
                    Console.WriteLine("Local discovery fixture: controlled call completed.");
                }
                return [new(Driver.Wia, "fixture-discovery", "Local discovery fixture (no scanner)")];
            }, () => { });
        }
        if (mode is not ("partial" or "all" or "setup")) throw new ArgumentException("Unknown local discovery fixture mode");
        return new Naps2Backend(null, driver => mode == "all" || driver == Driver.Twain
            ? throw new IOException("PRIVATE fixture driver path")
            : Task.FromResult(new List<ScanDevice> { new(Driver.Wia, "fixture-discovery", "Local discovery fixture (no scanner)") }),
            () => { if (mode == "setup") throw new IOException("PRIVATE fixture worker setup"); });
    }
}
