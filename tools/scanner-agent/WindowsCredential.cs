using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Mtg.Scanner;

// Windows stores generic credentials privately for the logged-in user. The
// connection JSON contains only public identity/site settings, never the secret.
public static class WindowsCredential
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Write(ref Credential value, uint flags);
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Delete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);
    private static string Target(Guid id) => $"MTGArchives.Scanner.{id}";
    public static void Save(Guid id, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        if (id == Guid.Empty || bytes.Length is 0 or > 2560) throw new ArgumentException("Invalid scanner credential");
        var memory = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, memory, bytes.Length);
            var credential = new Credential { Type = 1, TargetName = Target(id),
                Comment = "MTG Archives scanner helper", CredentialBlob = memory,
                CredentialBlobSize = (uint)bytes.Length, Persist = 2, UserName = "MTGArchives.Scanner",
                TargetAlias = "" };
            if (!Write(ref credential, 0)) throw new InvalidOperationException("Windows could not save the scanner credential");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            Marshal.Copy(bytes, 0, memory, bytes.Length);
            Marshal.FreeHGlobal(memory);
        }
    }
    public static string Load(Guid id)
    {
        if (!Read(Target(id), 1, 0, out var pointer)) throw new InvalidOperationException("Scanner connection credential unavailable");
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            if (credential.CredentialBlobSize is 0 or > 2560) throw new InvalidOperationException("Invalid scanner credential");
            var bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            try { return Encoding.UTF8.GetString(bytes); }
            finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        finally { CredFree(pointer); }
    }
    public static void Remove(Guid id)
    {
        if (!Delete(Target(id), 1, 0) && Marshal.GetLastWin32Error() != 1168)
            throw new InvalidOperationException("Windows could not remove the scanner credential");
    }
}
