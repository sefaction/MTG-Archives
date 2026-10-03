using System;
using System.IO;

internal static class CountFeedPolicy
{
    internal static int Target(string[] args)
    {
        if (args.Length != 3 || args[2] != "operator-ready" || !Path.IsPathRooted(args[1]))
            throw new ArgumentException("Explicit operator readiness and a new absolute private directory are required");
        if (args[0] == "feed-one-of-three") return 1;
        if (args[0] == "feed-two-of-three") return 2;
        throw new ArgumentException("Only the one-of-three and two-of-three qualification gates are enabled");
    }
    internal static void RequireReadback<T>(bool success, T requested, T actual)
    {
        if (!success || !Object.Equals(requested, actual))
            throw new InvalidOperationException("Counted scan configuration was not accepted exactly");
    }
    internal static void RequireNewDirectory(string directory)
    {
        if (Directory.Exists(directory) || File.Exists(directory))
            throw new InvalidOperationException("Existing journal cannot authorize a refeed");
    }
    internal static void SelfTest()
    {
        var root = Path.Combine(Path.GetTempPath(), "MtgCountPolicy-" + Guid.NewGuid().ToString("N"));
        if (Target(new[] { "feed-one-of-three", root, "operator-ready" }) != 1 ||
            Target(new[] { "feed-two-of-three", root, "operator-ready" }) != 2)
            throw new InvalidOperationException("Allowed count policy failed");
        foreach (var invalid in new[] {
            new[] { "feed-one-of-three", root, "" }, new[] { "feed-one-of-three", "relative", "operator-ready" },
            new[] { "feed-83", root, "operator-ready" }, new[] { "feed-one-of-three", root },
        })
        {
            var refused = false;
            try { Target(invalid); } catch (ArgumentException) { refused = true; }
            if (!refused) throw new InvalidOperationException("Invalid feed authorization accepted");
        }
        RequireReadback(true, 1, 1);
        foreach (var attempt in new[] { new[] { 0, 1 }, new[] { 1, -1 }, new[] { 1, 2 } })
        {
            var refused = false;
            try { RequireReadback(attempt[0] == 1, 1, attempt[1]); }
            catch (InvalidOperationException) { refused = true; }
            if (!refused) throw new InvalidOperationException("Rejected/clamped/unlimited count accepted");
        }
        RequireNewDirectory(root);
        Directory.CreateDirectory(root);
        try
        {
            var refused = false;
            try { RequireNewDirectory(root); } catch (InvalidOperationException) { refused = true; }
            if (!refused) throw new InvalidOperationException("Journal replay accepted");
        }
        finally { Directory.Delete(root); }
        Console.WriteLine("PASS explicit count/readiness, count mismatch/refusal, and no journal replay; no DSM/source/motor");
    }
}
