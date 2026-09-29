using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace Mtg.Scanner;

// Mechanical transport check. No hardware enumeration or backend instance.
public static class ScannerNativeSelfTest
{
    private sealed class FixtureHandler(NativeInstruction instruction, ScannerArtifact artifact) : HttpMessageHandler
    {
        public NativeInstruction Instruction = instruction;
        public Guid ServerEpoch = instruction.Epoch;
        public Guid PhotoId = Guid.NewGuid();
        public int UploadAttempts, Finishes;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            object response;
            if (request.RequestUri!.AbsolutePath == "/api/scanner-agent/images") {
                var meta = JsonSerializer.Deserialize<JsonElement>(request.Headers.GetValues("x-mtg-scanner").Single());
                if (meta.GetProperty("artifactId").GetGuid()!=artifact.Id || meta.GetProperty("sequence").GetInt32()!=1 ||
                    Convert.ToHexString(SHA256.HashData(await request.Content!.ReadAsByteArrayAsync())).ToLowerInvariant()!=artifact.Sha256)
                    throw new InvalidDataException("Fixture transfer identity changed");
                // First upload was received, but the acknowledgment is lost.
                if (++UploadAttempts==1) throw new HttpRequestException("Fixture lost ACK");
                response = new { version=1,runId=Instruction.RunId,artifactId=artifact.Id,sequence=1,photoId=PhotoId,digest=artifact.Sha256,ready=true };
            }
            else {
                var body = JsonSerializer.Deserialize<JsonElement>(await request.Content!.ReadAsStringAsync());
                if (body.GetProperty("action").GetString()=="poll") response = new { version=1,agentId=AgentId,epoch=ServerEpoch,run=Instruction };
                else if (body.GetProperty("action").GetString()=="finish") {
                    if(body.GetProperty("outcome").GetProperty("imageCount").GetInt32()!=1) throw new InvalidDataException("Fixture count changed");
                    Finishes++;response = new {version=1,runId=Instruction.RunId,status="DRAINED",physicalCount="UNCONFIRMED"};
                }
                else throw new InvalidOperationException("No second START is allowed by fixture");
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(response,RunSpool.Json)) };
        }
        public Guid AgentId;
    }
    public static async Task Run(string fixtureRoot)
    {
        var root = Path.Combine(Path.GetFullPath(fixtureRoot),Guid.NewGuid().ToString());
        Directory.CreateDirectory(root);
        Guid agentId=Guid.NewGuid(),runId=Guid.NewGuid(),execution=Guid.NewGuid();
        var settings=new NativeSettings(300,2.6m,3.6m,"Start",false,"RGB",false,false,false);
        var instruction=new NativeInstruction(1,runId,Guid.NewGuid(),"fixture-session","fixture-device",1,settings,1,false,"STARTED",execution);
        var request=new ScanRequest(runId,"fixture-device",SessionPhysicalTarget:1);
        var runsRoot=Path.Combine(root,agentId.ToString(),"runs");
        ScannerArtifact artifact;
        string directory;
        try {
            using(var spool=new RunSpool(runsRoot,request,new {backend="fixture; no hardware"})) {
                directory=spool.DirectoryPath;
                RunSpool.WriteNew(Path.Combine(directory,"binding.json"),new NativeBinding(1,instruction,execution));
                spool.Event("AcquisitionStarted",new {fixture=true});
                var temporary=Path.Combine(directory,"fixture.pending.png");
                using(var bitmap=new System.Drawing.Bitmap(10,14)) bitmap.Save(temporary,System.Drawing.Imaging.ImageFormat.Png);
                artifact=spool.PublishImage(temporary,Guid.NewGuid(),1,10,14);
                spool.Event("AcquisitionCompleted",new {outcome="COMPLETED",imageCount=1,elapsedMs=1,knownPhysicalItems=(int?)null,sourceExhausted="UNKNOWN"});
            }
            using var handler=new FixtureHandler(instruction,artifact){AgentId=agentId};
            using var client=new HttpClient(handler){BaseAddress=new Uri("https://fixture.invalid/")};
            var backendCalls=0;
            Func<IScannerBackend> noBackend=()=>{backendCalls++;throw new InvalidOperationException("Fixture attempted physical backend");};
            var devices=new[]{new Device("fixture-device","Fixture","fixture","fixture")};
            try {await ScannerNativeRunner.PollAndRun(client,agentId,"fixture",root,devices,CancellationToken.None,noBackend);
                throw new InvalidOperationException("Lost ACK should require retry");} catch(HttpRequestException){}
            await ScannerNativeRunner.PollAndRun(client,agentId,"fixture",root,devices,CancellationToken.None,noBackend);
            if(handler.UploadAttempts!=2 || handler.Finishes!=1 || backendCalls!=0 ||
                !File.Exists(Path.Combine(directory,artifact.FileName))) throw new InvalidOperationException("Replay conservation failed");
            handler.ServerEpoch=Guid.NewGuid();
            try {await ScannerNativeRunner.PollAndRun(client,agentId,"fixture",root,devices,CancellationToken.None,noBackend);
                throw new InvalidDataException("Epoch mismatch was accepted");} catch(InvalidOperationException){}
            handler.ServerEpoch=instruction.Epoch;
            handler.Instruction=instruction with {DeviceId="changed-device"};
            try {await ScannerNativeRunner.PollAndRun(client,agentId,"fixture",root,devices,CancellationToken.None,noBackend);
                throw new InvalidDataException("Binding mismatch was accepted");} catch(InvalidOperationException){}
            handler.Instruction=instruction;
            handler.PhotoId=Guid.NewGuid();
            try {await ScannerNativeRunner.PollAndRun(client,agentId,"fixture",root,devices,CancellationToken.None,noBackend);
                throw new InvalidOperationException("Changed receipt was accepted");} catch(InvalidDataException){}
            if(backendCalls!=0 || !File.Exists(Path.Combine(directory,artifact.FileName))) throw new InvalidOperationException("Recovery attempted refeed/deletion");
            Console.WriteLine("PASS native helper ACK-loss replay, duplicate-run recovery without backend, epoch/binding/receipt fencing and retained original; no hardware");
        } finally {
            if(Path.GetDirectoryName(root)!=Path.GetFullPath(fixtureRoot) || !Guid.TryParse(Path.GetFileName(root),out _))
                throw new InvalidOperationException("Fixture cleanup escaped its own directory");
            Directory.Delete(root,true);
        }
    }
}
