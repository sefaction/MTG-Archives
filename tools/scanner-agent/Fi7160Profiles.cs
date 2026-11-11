using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Mtg.Scanner;

// Read only the bounded, pinned export packaged with this helper. The vendor
// importer owns all writes to the installed PaperStream profile store.
internal static class Fi7160Profiles
{
    internal const string FileName = "MTG-Cards-7160-v1.pav";
    internal const string Hash = "e0d1ab56ccce8c4b8531da433a41e9b469c08462dea71d2f24864f8b03da781c";
    internal const string Name600 = "MTG Cards 600 DPI";
    internal const string Name300 = "MTG Cards 300 DPI";
    internal static string Store => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Fujitsu", "iCube", "FTS");

    internal static byte[] Payload()
    {
        using var input = typeof(Fi7160Profiles).Assembly.GetManifestResourceStream("Mtg.ScannerAgent.Profiles." + FileName)
            ?? throw new InvalidDataException("The Cards profiles are missing. Reinstall the helper.");
        using var output = new MemoryStream(); input.CopyTo(output);
        var bytes = output.ToArray();
        if (bytes.Length != 54123 || !Convert.ToHexString(SHA256.HashData(bytes)).Equals(Hash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The bundled Cards profiles failed their integrity check.");
        return bytes;
    }

    internal static string Materialize(string folder)
    {
        Fi7160SetupPackages.RejectReparseDirectories(folder);
        Directory.CreateDirectory(folder);
        Fi7160SetupPackages.RejectReparseDirectories(folder);
        var file = Path.Combine(folder, FileName);
        var bytes = Payload();
        if (File.Exists(file))
        {
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0 || !File.ReadAllBytes(file).SequenceEqual(bytes))
                throw new InvalidDataException("An unexpected Cards package already exists. Keep it and choose another setup cache.");
            return file;
        }
        using var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        output.Write(bytes); output.Flush(true);
        return file;
    }

    // This parser is a verifier, not a general PAV writer/importer. All entry
    // names, framing, lengths and the entire payload hash are fixed above.
    internal static Dictionary<string, byte[]> Entries()
    {
        using var input = new MemoryStream(Payload()); using var reader = new BinaryReader(input, Encoding.Unicode);
        input.Position = 72;
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var expected in new[] { "FTS_EX000004.xml", "FTS_EX000005.xml", "Id.bin", "SettingInfo.ini" })
        {
            Exact(reader, "020004100900");
            var name = Text(reader);
            if (name != expected) throw new InvalidDataException("Unexpected Cards package entry.");
            Exact(reader, "02000a100900");
            if (Text(reader) != "") throw new InvalidDataException("Unexpected Cards package metadata.");
            Exact(reader, "0200051005000100");
            var size = reader.ReadUInt64();
            foreach (var tag in new[] { "0200061005000100", "0200081005000100", "0200071005000100" })
            { Exact(reader, tag); reader.ReadUInt64(); }
            Exact(reader, "020009100a000100200000000300000000000000");
            if (size > 30000) throw new InvalidDataException("Cards package entry is too large.");
            var data = reader.ReadBytes((int)size);
            if (data.Length != (int)size) throw new InvalidDataException("Truncated Cards package.");
            result.Add(name, data);
        }
        Exact(reader, "0400000000000000");
        if (input.Position != input.Length) throw new InvalidDataException("Extra Cards package data.");
        return result;
    }

    private static void Exact(BinaryReader reader, string hex)
    {
        var expected = Convert.FromHexString(hex);
        if (!reader.ReadBytes(expected.Length).SequenceEqual(expected)) throw new InvalidDataException("Invalid Cards package framing.");
    }
    private static string Text(BinaryReader reader)
    {
        var chars = reader.ReadUInt16();
        if (chars is < 1 or > 80) throw new InvalidDataException("Invalid Cards package string.");
        var data = reader.ReadBytes(chars * 2);
        if (data.Length != chars * 2 || data[^1] != 0 || data[^2] != 0) throw new InvalidDataException("Invalid Cards package string.");
        return Encoding.Unicode.GetString(data, 0, data.Length - 2);
    }
    internal static XElement Xml(byte[] data)
    {
        if (data.Length > 65536) throw new InvalidDataException("Unexpected profile size.");
        using var stream = new MemoryStream(data);
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 65536 });
        var root = XElement.Load(reader);
        if (root.Name != "Capabilities" || (string?)root.Element("version") != "3.40.2.1783" ||
            !((string?)root.Element("scanner") ?? "").StartsWith("FUJITSU fi-7160 #", StringComparison.Ordinal))
            throw new InvalidDataException("The Cards profile belongs to a different driver/model.");
        return root;
    }

    private static string Signature(XElement root)
    {
        var clone = new XElement(root);
        // Driver-local device ordinal and output directory are not capture
        // settings. Every other capability, including unknown vendor values,
        // must equal the curated baseline; do not guess their meanings.
        clone.Element("scanner")!.Value = "FUJITSU fi-7160";
        foreach (var cap in clone.Elements("capability").Where(c => (string?)c.Element("name") == "41112"))
            cap.Element("value")!.Value = "";
        return clone.ToString(SaveOptions.DisableFormatting);
    }

    internal static bool Installed(string? directory = null)
    {
        var store = directory ?? Store;
        if (!Directory.Exists(store)) return false;
        Fi7160SetupPackages.RejectReparseDirectories(store);
        var ini = Path.Combine(store, "SettingInfo.ini");
        if (!File.Exists(ini) || new FileInfo(ini).Length > 1024 * 1024) return false;
        var entries = Entries();
        var expected = new Dictionary<string, string> {
            [Name600] = Signature(Xml(entries["FTS_EX000004.xml"])),
            [Name300] = Signature(Xml(entries["FTS_EX000005.xml"])) };
        var found = new HashSet<string>();
        foreach (var line in File.ReadLines(ini))
        {
            var equal = line.IndexOf('=');
            if (equal != 6 || !line[..6].All(char.IsAsciiDigit)) continue;
            var name = line[(equal + 1)..];
            if (!expected.TryGetValue(name, out var signature)) continue;
            var file = Path.Combine(store, "FTS_EX" + line[..6] + ".xml");
            if (!File.Exists(file) || new FileInfo(file).Length > 65536 || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) continue;
            try { if (Signature(Xml(File.ReadAllBytes(file))) == signature) found.Add(name); }
            catch (Exception error) when (error is InvalidDataException or XmlException) { }
        }
        return found.Count == 2;
    }
}
