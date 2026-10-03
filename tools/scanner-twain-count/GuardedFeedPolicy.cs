using System;
using System.IO;

// Physical diagnostics only. Visible Pre-Pick Off in this open session and
// fresh operator loading/readiness are separate requirements from image count.
internal static class GuardedFeedPolicy
{
    internal static int Target(string[] args)
    {
        if (args.Length != 3 || !Path.IsPathRooted(args[1]) || !Path.IsPathRooted(args[2]) ||
            Path.GetFileName(args[2]) != "Mtg.CountedTwain.exe")
            throw new ArgumentException("New absolute evidence directory and known worker assembly required");
        if (args[0] == "qualify-one-of-three") return 1;
        if (args[0] == "qualify-two-of-three") return 2;
        throw new ArgumentException("Only revised one/two-of-three diagnostics are enabled");
    }
    internal static string Authorization(string nonce, int target)
    {
        return "session=" + nonce + ";target=" + target +
            ";visible-prepick=off;loaded=3-expendable;transport=clear;ready=once";
    }
    internal static void RequireAuthorization(string actual, string nonce, int target)
    {
        if (actual != Authorization(nonce, target))
            throw new InvalidOperationException("Fresh same-session Off/loading/readiness confirmation required");
    }
    internal static void RequireObservedInvariant(bool readable, object value)
    {
        // 0x80FD is an observed driver correlation, not an official Pre-Pick
        // mapping. It is only a drift guard after separate visible Off readback.
        if (!readable || !(value is ushort) || (ushort)value != 0)
            throw new InvalidOperationException("Observed driver invariant changed or is unavailable; no feed");
    }
    internal static void SelfTest()
    {
        var root = Path.Combine(Path.GetTempPath(), "MtgGuardedFeed-" + Guid.NewGuid().ToString("N"));
        var worker = Path.Combine(root, "Mtg.CountedTwain.exe");
        if (Target(new[] { "qualify-one-of-three", root, worker }) != 1 ||
            Target(new[] { "qualify-two-of-three", root, worker }) != 2)
            throw new InvalidOperationException("Small diagnostic target policy failed");
        foreach (var command in new[] { "feed-one-of-three", "feed-two-of-three", "qualify-ten", "helper-channel-v1", "start" })
        {
            var denied = false;
            try { Target(new[] { command, root, worker }); } catch (ArgumentException) { denied = true; }
            if (!denied) throw new InvalidOperationException("Legacy/unqualified feeding accepted");
        }
        var nonce = Guid.NewGuid().ToString("N");
        RequireAuthorization(Authorization(nonce, 1), nonce, 1);
        foreach (var token in new[] { "operator-ready", "", Authorization(nonce, 2), Authorization("old-session", 1),
            Authorization(nonce, 1).Replace("visible-prepick=off", "visible-prepick=on"),
            Authorization(nonce, 1).Replace("loaded=3-expendable", "loaded=83") })
        {
            var denied = false;
            try { RequireAuthorization(token, nonce, 1); } catch (InvalidOperationException) { denied = true; }
            if (!denied) throw new InvalidOperationException("Stale/incomplete readiness accepted");
        }
        RequireObservedInvariant(true, (ushort)0);
        foreach (var value in new object[] { (ushort)1, (ushort)2, 0, false, null })
        {
            var denied = false;
            try { RequireObservedInvariant(true, value); } catch (InvalidOperationException) { denied = true; }
            if (!denied) throw new InvalidOperationException("Changed/mistyped driver invariant accepted");
        }
        var unreadableDenied = false;
        try { RequireObservedInvariant(false, (ushort)0); } catch (InvalidOperationException) { unreadableDenied = true; }
        if (!unreadableDenied) throw new InvalidOperationException("Unavailable driver invariant accepted");
        Console.WriteLine("PASS revised small targets, legacy refusal, same-session readiness and typed observed drift guard; no hardware");
    }
}
