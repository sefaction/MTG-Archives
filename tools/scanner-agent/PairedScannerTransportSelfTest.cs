using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
namespace Mtg.Scanner;
// Uses actual durable manifests and HTTP serialization; never constructs a native backend.
internal static class PairedScannerTransportSelfTest
{
    private sealed class Handler(NativeInstruction instruction, Guid agentId, List<ScannerArtifact> images) : HttpMessageHandler
    {
        internal int Finishes, Uploads;
        private bool lost;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
        {
            object result;
            if(request.RequestUri!.AbsolutePath=="/api/scanner-agent/images") {
                var metadata=JsonSerializer.Deserialize<JsonElement>(request.Headers.GetValues("x-mtg-scanner").Single());
                var image=images.Single(i=>i.Id==metadata.GetProperty("artifactId").GetGuid());
                if(metadata.GetProperty("side").GetString()!=image.Side || metadata.GetProperty("physicalBoundary").GetString()!="SCANNER_SHEET" ||
                    metadata.GetProperty("sheet").GetProperty("paperCount").GetInt32()!=1 || metadata.GetProperty("executionId").GetGuid()!=instruction.ExecutionId ||
                    Convert.ToHexString(SHA256.HashData(await request.Content!.ReadAsByteArrayAsync())).ToLowerInvariant()!=image.Sha256)
                    throw new InvalidDataException("Paired source identity changed in HTTP transport");
                Uploads++;
                if(image.Side=="BACK"&&!lost){lost=true;throw new HttpRequestException("Fixture lost paired ACK");}
                result=new {version=1,runId=instruction.RunId,artifactId=image.Id,sequence=image.Sequence,photoId=image.Id,digest=image.Sha256,ready=true};
            } else {
                var body=JsonSerializer.Deserialize<JsonElement>(await request.Content!.ReadAsStringAsync());
                if(body.GetProperty("action").GetString()=="poll")result=new {version=1,agentId,epoch=instruction.Epoch,run=instruction};
                else if(body.GetProperty("action").GetString()=="finish"){
                    if(body.GetProperty("outcome").GetProperty("imageCount").GetInt32()!=2)throw new InvalidDataException("Paired finish quantity changed");
                    Finishes++;result=new {version=1,runId=instruction.RunId,status="DRAINED"};
                }else throw new InvalidDataException("Paired recovery attempted another START");
            }
            return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(JsonSerializer.Serialize(result,RunSpool.Json))};
        }
    }
    internal static async Task Run(string fixtureRoot)
    {
        var root=Path.Combine(Path.GetFullPath(fixtureRoot),Guid.NewGuid().ToString());Directory.CreateDirectory(root);
        Guid agentId=Guid.NewGuid(),runId=Guid.NewGuid(),executionId=Guid.NewGuid();
        var settings=new NativeSettings(600,2.7m,3.6m,"Center",true,"RGB",false,false,false);
        var instruction=new NativeInstruction(1,runId,Guid.NewGuid(),"paired-fixture",CountedTwainBackend.DeviceId,null,settings,1,false,"STARTED",executionId,Counted:true,ScanProfile:"TOKEN");
        var request=new ScanRequest(runId,CountedTwainBackend.DeviceId,600,2.7m,3.6m,Duplex:true,SessionPhysicalTarget:1,ScanProfile:"TOKEN");
        var images=new List<ScannerArtifact>();string directory;
        try {
            using(var spool=new RunSpool(Path.Combine(root,agentId.ToString(),"runs"),request,new {fixture=true,hardware=false})){
                directory=spool.DirectoryPath;RunSpool.WriteNew(Path.Combine(directory,"binding.json"),new NativeBinding(1,instruction,executionId));
                spool.Event("AcquisitionStarted",new {fixture=true});
                foreach(var side in new[]{"BACK","FRONT"}){
                    var id=Guid.NewGuid();var temporary=Path.Combine(directory,id+".pending.png");
                    using(var bitmap=new System.Drawing.Bitmap(10,14))bitmap.Save(temporary,System.Drawing.Imaging.ImageFormat.Png);
                    images.Add(spool.PublishImage(temporary,id,images.Count+1,10,14,side,new ScannerSheet(1,0,1)));
                }
                spool.Event("AcquisitionCompleted",new {outcome="COMPLETED",imageCount=2,elapsedMs=1,knownPhysicalItems=(int?)null,sourceExhausted="UNKNOWN"});
            }
            using var handler=new Handler(instruction,agentId,images);using var client=new HttpClient(handler){BaseAddress=new Uri("https://fixture.invalid/")};
            var backendCalls=0;Func<IScannerBackend> refused=()=>{backendCalls++;throw new InvalidOperationException("No hardware allowed");};
            try{await ScannerNativeRunner.PollAndRun(client,agentId,"fixture",root,[CountedTwainBackend.ProfileDevice],default,refused,advertisedVersion:ScannerConnection.PairedVersion);throw new InvalidDataException("Paired ACK loss did not require retry");}catch(HttpRequestException){}
            await ScannerNativeRunner.PollAndRun(client,agentId,"fixture",root,[CountedTwainBackend.ProfileDevice],default,refused,advertisedVersion:ScannerConnection.PairedVersion);
            if(backendCalls!=0||handler.Uploads!=3||handler.Finishes!=1||images.Any(i=>!File.Exists(Path.Combine(directory,i.FileName))))throw new InvalidDataException("Paired ACK recovery lost originals or re-fed");
            Console.WriteLine("PASS paired actual manifests/HTTP: reversed sheet sides, lost ACK, exact replay and one finish; originals retained, no backend constructed");
        } finally {
            if(Path.GetDirectoryName(root)!=Path.GetFullPath(fixtureRoot)||!Guid.TryParse(Path.GetFileName(root),out _))throw new InvalidOperationException("Paired fixture cleanup escaped");
            Directory.Delete(root,true);
        }
    }
}
