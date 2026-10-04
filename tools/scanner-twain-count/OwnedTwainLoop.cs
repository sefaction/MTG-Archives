using System;
using System.Threading;
using System.Windows.Forms;
using NTwain;

// Own the native window through thread termination. NTwain's default WPF hook
// requests shutdown without joining its background thread; process exit can
// race that window's disposal. No DSM/source is created by this class.
internal sealed class OwnedTwainLoop : IDisposable
{
    private readonly ManualResetEvent ready = new ManualResetEvent(false);
    private readonly Thread thread;
    private ApplicationContext context;
    private Exception startupError;
    internal MessageLoopHook Hook { get; private set; }
    internal IntPtr WindowHandle { get; private set; }
    internal bool IsAlive { get { return thread.IsAlive; } }
    internal int ThreadId { get { return thread.ManagedThreadId; } }

    internal OwnedTwainLoop()
    {
        thread = new Thread(Run) { IsBackground = false, Name = "Owned TWAIN message loop" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        ready.WaitOne();
        if (startupError != null) { thread.Join(); ready.Dispose(); throw new InvalidOperationException("Message loop startup failed", startupError); }
    }

    private void Run()
    {
        EventHandler idle = null;
        try
        {
            using (var window = new Control())
            using (context = new ApplicationContext())
            {
                WindowHandle = window.Handle;
                idle = delegate {
                    Application.Idle -= idle;
                    try { Hook = new WindowsFormsMessageLoopHook(WindowHandle); }
                    catch (Exception error) { startupError = error; context.ExitThread(); }
                    finally { ready.Set(); }
                };
                Application.Idle += idle;
                Application.Run(context);
            }
        }
        catch (Exception error) { startupError = error; ready.Set(); }
        finally { if (idle != null) Application.Idle -= idle; }
    }

    internal void Invoke(Action action) { Hook.Invoke(action); }

    // Caller must first verify source and DSM closure (TWAIN state 2).
    // Never use this to abort an enabled source or force a scanner shutdown.
    public void Dispose()
    {
        if (!thread.IsAlive) { ready.Dispose(); return; }
        if (Thread.CurrentThread == thread) throw new InvalidOperationException("Cannot join the loop from itself");
        Hook.Invoke(delegate { context.ExitThread(); });
        thread.Join();
        ready.Dispose();
    }
}
