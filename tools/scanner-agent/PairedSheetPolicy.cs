using System;
using System.Collections.Generic;
using System.Linq;
// Metadata-only accounting. Never pairs images by adjacency or recognition.
internal sealed class PairedSheetPolicy
{
    private readonly Dictionary<int, Dictionary<int, HashSet<string>>> documents = new Dictionary<int, Dictionary<int, HashSet<string>>>();
    private bool faulted;
    internal bool Receive(int document, int paper, string side)
    {
        if (document < 0 || paper < 1 || (side != "FRONT" && side != "BACK")) { faulted=true; return false; }
        Dictionary<int, HashSet<string>> pages;
        if (!documents.TryGetValue(document,out pages)) { pages=new Dictionary<int,HashSet<string>>();documents.Add(document,pages); }
        HashSet<string> sides;
        if (!pages.TryGetValue(paper,out sides)) { sides=new HashSet<string>();pages.Add(paper,sides); }
        if (!sides.Add(side)) { faulted=true; return false; }
        return true;
    }
    internal bool Complete
    {
        get { return !faulted && documents.All(d=>d.Value.Keys.OrderBy(v=>v).Select((v,i)=>v==i+1).All(v=>v) && d.Value.Values.All(v=>v.Count==2)); }
    }
    internal static void SelfTest()
    {
        var pair=new PairedSheetPolicy();
        if (!pair.Receive(0,1,"BACK") || pair.Complete || !pair.Receive(0,1,"FRONT") || !pair.Complete) throw new Exception("Paired side accounting failed");
        var gap=new PairedSheetPolicy();gap.Receive(0,1,"FRONT");gap.Receive(0,1,"BACK");gap.Receive(0,3,"FRONT");gap.Receive(0,3,"BACK");
        if(gap.Complete || pair.Receive(0,1,"BACK") || pair.Complete)throw new Exception("Ambiguous sheets became complete");
        Console.WriteLine("PASS paired native policy: reversed sides, missing side, physical gap, duplicate side; no positional pairing");
    }
}
