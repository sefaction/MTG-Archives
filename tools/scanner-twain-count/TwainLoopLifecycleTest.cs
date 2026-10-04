using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using NTwain;

// Motor-free baseline for #606: only the pinned library's hidden message loop
// and a synthetic DIB. Never constructs/opens a TWAIN session or scanner source.
internal static class TwainLoopLifecycleTest
{
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);
    private sealed class FilterProvider : MessageLoopHook
    {
        private sealed class Filter : IWinMessageFilter
        {
            public bool IsTwainMessage(IntPtr window, int message, IntPtr w, IntPtr l) { return false; }
        }
        internal static object EmptyFilter() { return new Filter(); }
        protected override void Start(IWinMessageFilter filter) { throw new NotSupportedException(); }
        protected override void Stop() { throw new NotSupportedException(); }
    }
    private static void SyntheticRetention()
    {
        using (var bitmap = new Bitmap(10, 14, PixelFormat.Format24bppRgb))
        using (var bytes = new MemoryStream())
        {
            bitmap.SetPixel(3, 5, Color.FromArgb(27, 82, 139));
            bitmap.Save(bytes, ImageFormat.Bmp);
            var bmp = bytes.ToArray();
            var native = Marshal.AllocHGlobal(bmp.Length - 14);
            try
            {
                Marshal.Copy(bmp, 14, native, bmp.Length - 14);
                using (var stream = new DataTransferredEventArgs(null, native).GetNativeImageStream())
                using (var retained = new Bitmap(stream))
                using (var png = new MemoryStream())
                {
                    retained.Save(png, ImageFormat.Png);
                    png.Position = 0;
                    using (var readback = new Bitmap(png))
                        if (readback.Width != 10 || readback.Height != 14 ||
                            readback.GetPixel(3, 5).ToArgb() != bitmap.GetPixel(3, 5).ToArgb())
                            throw new InvalidOperationException("Synthetic native retention changed pixels");
                }
            }
            finally { Marshal.FreeHGlobal(native); }
        }
    }
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "owned-loop")
        {
            var owned = new OwnedTwainLoop();
            var handle = owned.WindowHandle;
            if (!IsWindow(handle)) throw new InvalidOperationException("Owned window never created");
            var hook = owned.Hook;
            var hookType = hook.GetType();
            var hookFlags = BindingFlags.Instance | BindingFlags.NonPublic;
            owned.Invoke(delegate {
                if (Thread.CurrentThread.ManagedThreadId != owned.ThreadId ||
                    Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
                    throw new InvalidOperationException("Wrong event/retention thread");
                hookType.GetMethod("Start", hookFlags).Invoke(hook, new[] { FilterProvider.EmptyFilter() });
                SyntheticRetention();
                hookType.GetMethod("Stop", hookFlags).Invoke(hook, null);
            });
            var propagated = false;
            try { owned.Invoke(delegate { throw new InvalidOperationException("expected-test-error"); }); }
            catch (InvalidOperationException error) { propagated = error.Message == "expected-test-error"; }
            if (!propagated) throw new InvalidOperationException("Loop hid operation failure");
            owned.Dispose();
            if (owned.IsAlive || IsWindow(handle)) throw new InvalidOperationException("Loop/window outlived disposal");
            Console.WriteLine("Owned loop joined; window destroyed; native image pixels retained; operation failures propagated; no DSM/source/motor");
            return 0;
        }
        if (args.Length != 1 || args[0] != "internal-loop-baseline") return 2;
        var type = typeof(TwainSession).Assembly.GetType("NTwain.Internals.InternalMessageLoopHook", true);
        var loop = (MessageLoopHook)Activator.CreateInstance(type, true);
        var flags = BindingFlags.Instance | BindingFlags.NonPublic;
        type.GetMethod("Start", flags).Invoke(loop, new[] { FilterProvider.EmptyFilter() });
        loop.Invoke(SyntheticRetention);
        type.GetMethod("Stop", flags).Invoke(loop, null);
        Console.WriteLine("Baseline hidden loop stopped; synthetic image retained; no DSM/source/motor");
        return 0;
    }
}
