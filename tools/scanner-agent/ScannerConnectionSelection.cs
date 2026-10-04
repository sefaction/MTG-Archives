using System.Text.Json;
using System.Windows.Forms;

namespace Mtg.Scanner;

// Selection contains only a saved connection identity, never credentials or a
// scan command. Ambiguous sign-in startup stays idle until the user chooses.
internal static class ScannerConnectionSelection
{
    internal static Guid? Resolve(IReadOnlyList<HelperConnection> available, Guid? preferred,
        Func<IReadOnlyList<HelperConnection>, Guid?, Guid?>? choose = null)
    {
        if (available.Count == 0) return null;
        var validPreferred = available.Any(c => c.AgentId == preferred) ? preferred : null;
        var selected = choose != null ? choose(available, validPreferred) :
            validPreferred ?? (preferred == null && available.Count == 1 ? available[0].AgentId : null);
        if (selected != null && !available.Any(c => c.AgentId == selected))
            throw new InvalidOperationException("Selected scanner connection is unavailable");
        return selected;
    }

    internal static Guid? Read(string root)
    {
        try {
            var value = JsonSerializer.Deserialize<Selection>(File.ReadAllText(Path.Combine(root, "selected-connection.json")), RunSpool.Json);
            return value?.Version == 1 && value.AgentId != Guid.Empty ? value.AgentId : Guid.Empty;
        } catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException) { return null; }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { return Guid.Empty; }
    }
    internal static void Save(string root, Guid id)
    {
        if (id == Guid.Empty) throw new ArgumentException("Choose a saved scanner connection");
        Directory.CreateDirectory(root);
        var destination = Path.Combine(root, "selected-connection.json");
        var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".pending";
        try { RunSpool.WriteNew(temporary, new Selection(1, id)); File.Move(temporary, destination, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private record Selection(int Version, Guid AgentId);
    internal static FileStream AcquireLease(string root)
    {
        Directory.CreateDirectory(root);
        return new FileStream(Path.Combine(root, "selected.serve.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }

    internal static Guid? Choose(IReadOnlyList<HelperConnection> available, Guid? preferred,
        Func<Guid, bool>? isOpen = null, Action<Guid>? close = null)
    {
        Guid? result = null;
        Exception? failure = null;
        var thread = new Thread(() => {
            try {
                using var dialog = new Form { Text = "Choose scanner connection", Width = 740, Height = 360,
                    StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog,
                    MaximizeBox = false, MinimizeBox = false, AutoScaleMode = AutoScaleMode.Dpi };
                var explanation = new Label { Text = "Choose the website connection to use on this computer.\nYour choice is remembered for sign-in. Opening a connection does not request a scan.",
                    Left = 20, Top = 20, Width = 690, Height = 55 };
                var label = new Label { Text = "Saved scanner connection", Left = 20, Top = 85, Width = 300 };
                var choices = new ComboBox { Left = 20, Top = 115, Width = 690, DropDownStyle = ComboBoxStyle.DropDownList,
                    AccessibleName = "Saved scanner connection" };
                foreach (var connection in available) choices.Items.Add(new Choice(connection, choices.Items.Count + 1, isOpen?.Invoke(connection.AgentId) == true));
                var initial = available.ToList().FindIndex(c => c.AgentId == preferred);
                if (initial < 0) initial = available.ToList().FindIndex(c => isOpen?.Invoke(c.AgentId) == true);
                choices.SelectedIndex = Math.Max(0, initial);
                var detail = new Label { Left = 20, Top = 155, Width = 690, Height = 45,
                    Text = "Older connections may have no saved account label. Other saved connections and scans are kept." };
                var closeButton = new Button { Text = "Close chosen connection", Left = 20, Top = 235, Width = 230 };
                void UpdateClose() => closeButton.Enabled = close != null && choices.SelectedItem is Choice c && isOpen?.Invoke(c.Connection.AgentId) == true;
                choices.SelectedIndexChanged += (_, _) => UpdateClose();
                closeButton.Click += (_, _) => {
                    if (choices.SelectedItem is not Choice c || close == null) return;
                    try { close(c.Connection.AgentId); }
                    catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException) {
                        MessageBox.Show(error is InvalidOperationException ? error.Message : "The connection could not be closed. Saved scans are kept.",
                            "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return;
                    }
                    MessageBox.Show("This connection will close after its current batch finishes. Saved scans are kept. Open the helper again to choose another connection.",
                        "MTG Archives Scanner", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    dialog.DialogResult = DialogResult.Cancel; dialog.Close();
                };
                UpdateClose();
                var open = new Button { Text = "Open connection", Left = 400, Top = 235, Width = 145,
                    DialogResult = DialogResult.OK };
                var cancel = new Button { Text = "Cancel", Left = 565, Top = 235, Width = 130,
                    DialogResult = DialogResult.Cancel };
                dialog.Controls.AddRange([explanation, label, choices, detail, closeButton, open, cancel]);
                dialog.AcceptButton = open; dialog.CancelButton = cancel;
                if (dialog.ShowDialog() == DialogResult.OK && choices.SelectedItem is Choice chosen)
                    result = chosen.Connection.AgentId;
            } catch (Exception error) { failure = error; }
        });
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join();
        if (failure != null) throw new InvalidOperationException("Scanner connection chooser unavailable", failure);
        return result;
    }
    private record Choice(HelperConnection Connection, int Number, bool Open)
    {
        public override string ToString() => $"{Connection.Account ?? Connection.Name} · {Connection.Site} · Connection {Number}{(Open ? " · Open" : "")}";
    }

    internal static void SelfTest()
    {
        var first = new HelperConnection(Guid.NewGuid(), "https://first.invalid/", "First", false);
        var second = new HelperConnection(Guid.NewGuid(), "https://second.invalid/", "Second", false);
        HelperConnection[] connections = [first, second];
        if (Resolve(connections, null) != null || Resolve(connections, Guid.NewGuid()) != null)
            throw new InvalidDataException("Ambiguous startup chose a connection");
        if (Resolve(connections, second.AgentId) != second.AgentId ||
            Resolve([first], second.AgentId) != null || Resolve([first], null) != first.AgentId || Resolve([], first.AgentId) != null ||
            Resolve(connections, first.AgentId, (_, _) => null) != null ||
            Resolve(connections, first.AgentId, (_, _) => second.AgentId) != second.AgentId)
            throw new InvalidDataException("Single-connection selection changed");
        try { Resolve(connections, first.AgentId, (_, _) => Guid.NewGuid());
            throw new InvalidDataException("Unknown connection selection accepted"); }
        catch (InvalidOperationException) { }
        var root = Path.Combine(Path.GetTempPath(), "mtg-selection-test-" + Guid.NewGuid().ToString("N"));
        try {
            if (Read(root) != null) throw new InvalidDataException("Missing selection was not idle");
            Save(root, first.AgentId); Save(root, second.AgentId);
            if (Read(root) != second.AgentId) throw new InvalidDataException("Selection did not persist");
            using (AcquireLease(root)) {
                try { using var duplicate = AcquireLease(root); throw new InvalidDataException("Multiple helper connections acquired the single lease"); }
                catch (IOException) { }
            }
            using (AcquireLease(root)) { }
            File.WriteAllText(Path.Combine(root, "selected-connection.json"), "{broken");
            if (Read(root) != Guid.Empty || Resolve([first], Read(root)) != null)
                throw new InvalidDataException("Invalid selection was not idle");
        } finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
