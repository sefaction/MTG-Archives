using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

namespace Mtg.Scanner;

// The bytes of the managed entry payload, not dotnet.exe or the native apphost.
// This is a helper self-report. It is neither signing nor remote attestation.
public record HelperIdentity(int Version, string PayloadKind, string Sha256, Guid ModuleVersionId,
    string HelperVersion, string ProtocolVersion, string Naps2SdkVersion);

public static class ScannerHelperIdentity
{
    private static readonly Lazy<HelperIdentity> Identity = new(ReadSelf);
    public static HelperIdentity Current => Identity.Value;
    internal static void VerifyAcknowledgement(HelperIdentity? expected, JsonElement acknowledgement)
    {
        if (expected != null && (!acknowledgement.TryGetProperty("helperIdentity", out var value) ||
            value.Deserialize<HelperIdentity>(RunSpool.Json) != expected))
            throw new InvalidDataException("Scanner helper identity acknowledgement changed; no feed started");
    }

    private static string PayloadHash(string file, Guid expectedModule)
    {
        // Keep one read-only handle for both metadata and hashing. Do not hash
        // a replacement file that differs from the executing managed module.
        using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var pe = new PEReader(stream, PEStreamOptions.LeaveOpen);
        if (!pe.HasMetadata) throw new InvalidDataException("Helper payload is not a managed assembly");
        var metadata = pe.GetMetadataReader();
        var module = metadata.GetGuid(metadata.GetModuleDefinition().Mvid);
        if (module == Guid.Empty || module != expectedModule)
            throw new InvalidDataException("Helper payload changed since the module was loaded");
        stream.Position = 0;
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static HelperIdentity ReadSelf()
    {
        try {
            var assembly = typeof(ScannerHelperIdentity).Assembly;
            // Current source/installer builds deliberately publish separate DLLs.
            // Unsupported single-file/custom packaging must not invent identity.
            if (string.IsNullOrEmpty(assembly.Location)) throw new InvalidDataException("Managed helper payload is unavailable");
            var module = assembly.ManifestModule.ModuleVersionId;
            if (assembly.GetName().Version?.ToString(3) != ScannerConnection.HelperVersion)
                throw new InvalidDataException("Helper source and assembly versions differ");
            return new HelperIdentity(1, "MANAGED_ASSEMBLY", PayloadHash(assembly.Location, module), module,
                ScannerConnection.HelperVersion, ScannerConnection.Version, "1.3.0");
        } catch (Exception error) when (error is IOException or BadImageFormatException or
            UnauthorizedAccessException or InvalidDataException or InvalidOperationException) {
            // The transport/public diagnostic must not include installation paths.
            throw new InvalidDataException("Helper binary identity unavailable; restart a verified installation");
        }
    }

    public static void SelfTest()
    {
        var identity = Current;
        var file = typeof(ScannerHelperIdentity).Assembly.Location;
        using var bytes = File.OpenRead(file);
        var independentlyHashed = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (identity.Sha256 != independentlyHashed || identity.ModuleVersionId == Guid.Empty ||
            !ReferenceEquals(identity, Current)) throw new InvalidDataException("Helper identity is not stable actual payload evidence");
        var invalidModule = Guid.NewGuid();
        try { PayloadHash(file, invalidModule); throw new InvalidOperationException("Wrong loaded module was accepted"); }
        catch (InvalidDataException) { }
        var instruction = new NativeInstruction(1, Guid.NewGuid(), Guid.NewGuid(), "fixture", "device", null,
            new NativeSettings(300, 2.6m, 3.6m, "Start", false, "RGB", false, false, false), null, false, "QUEUED", null);
        // Legacy local journals remain readable and do not submit a new field.
        var legacy = JsonSerializer.Deserialize<NativeBinding>(JsonSerializer.Serialize(new {
            version = 1, instruction, executionId = Guid.NewGuid() }, RunSpool.Json), RunSpool.Json)!;
        if (legacy.HelperIdentity != null || ScannerNativeRunner.ClaimPayload(legacy).ContainsKey("helperIdentity"))
            throw new InvalidDataException("Legacy claim contract changed");
        var binding = legacy with { HelperIdentity = identity };
        var claim = JsonSerializer.SerializeToElement(ScannerNativeRunner.ClaimPayload(binding), RunSpool.Json);
        if (claim.GetProperty("helperIdentity").GetProperty("sha256").GetString() != identity.Sha256 ||
            claim.GetProperty("executionId").GetGuid() != binding.ExecutionId)
            throw new InvalidDataException("Claim lost its immutable helper/execution identity");
        VerifyAcknowledgement(identity, claim);
        VerifyAcknowledgement(null, JsonSerializer.SerializeToElement(new { version = 1 }));
        foreach (var wrong in new[] { JsonSerializer.SerializeToElement(new { version = 1 }),
            JsonSerializer.SerializeToElement(new { helperIdentity = identity with { Sha256 = new string('a', 64) } }, RunSpool.Json) }) {
            try { VerifyAcknowledgement(identity, wrong); throw new InvalidOperationException("Changed helper acknowledgement accepted"); }
            catch (InvalidDataException) { }
        }
        Console.WriteLine("PASS actual managed payload hash/module/version, stable self-report, wrong-module refusal and legacy/new immutable claim contracts; no scanner or connection used");
    }
}
