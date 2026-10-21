// Recorded public catalog only; no client, proxying, forwarding or external I/O.
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
function verifyCatalog(catalog){
  assert.equal(catalog.fixtureSha256,'23a4a81ed1918f0718ca7a08b659caf24b25d6e65d3f9675ec021c5d7749c431');
  assert.equal(catalog.cards.length,87);assert.equal(catalog.outcomes.length,87);
  const ids=new Set(),keys=new Set();
  for(const card of catalog.cards){
    const {projectionSHA256,...record}=card;assert.equal(digest(JSON.stringify(record)),projectionSHA256);
    assert.match(card.id,/^[a-f0-9-]{36}$/);assert.match(card.set,/^[a-z0-9]+$/);assert.match(card.collector_number,/^[0-9]+$/);
    assert(!ids.has(card.id));ids.add(card.id);assert(!keys.has(card.set+'/'+card.collector_number));keys.add(card.set+'/'+card.collector_number);
    assert.equal(card.lang,'en');assert.equal(card.digital,false);
  }
  for(const row of catalog.outcomes){
    const card=catalog.cards.find(c=>c.id===row.card.id);assert(card);assert(['EXACT_NAME','EXACT_FLAVOR_NAME'].includes(row.outcome));assert.equal(row.card.name,card.name);assert.equal(row.card.flavor_name,card.flavor_name??null);
    assert.equal(card.set,row.set);assert.equal(card.collector_number,row.collector_number);
    assert.equal(row.name,row.outcome==='EXACT_FLAVOR_NAME'?card.flavor_name:card.name);
    assert(card.finishes.includes(row.foil?'foil':'nonfoil'));
  }
  return catalog.cards.map(({projectionSHA256,...record})=>record);
}
function handler(cards,receipt){
  let count=0;
  return (req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1:43127');let status=404,body={object:'error',code:'not_found',status:404,details:'Not in the recorded catalog fixture'},ids=[];
    if(++count>512){status=429;body={object:'error',code:'rate_limit_exceeded',status:429,details:'Recorded fixture request budget exceeded'};}
    else if(req.method!=='GET'){status=405;body={object:'error',code:'method_not_allowed',status:405,details:'GET only'};}
    else if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){status=403;body={object:'error',code:'forbidden',status:403,details:'Loopback only'};}
    else if(url.origin!=='http://127.0.0.1:43127'){status=404;}
    else if(url.pathname==='/__fixture_health'&&!url.search){status=200;body={ready:true,records:cards.length};}
    else {
      const exact=/^\/cards\/([a-z0-9]+)\/([0-9]+)$/.exec(url.pathname);
      if(exact&&!url.search){const card=cards.find(c=>c.set===exact[1]&&c.collector_number===exact[2]);if(card){status=200;body=card;ids=[card.id];}}
      else if(url.pathname==='/cards/search'&&url.searchParams.get('order')==='name'&&url.searchParams.get('unique')==='prints'&&[...url.searchParams.keys()].every(k=>['q','order','unique'].includes(k))){
        const q=url.searchParams.get('q');
        const found=cards.filter(c=>q==='name:"'+c.name.replace(/"/g,'\\"')+'"');
        if(found.length){status=200;body={object:'list',data:found,has_more:false,total_cards:found.length};ids=found.map(c=>c.id);}
      }
    }
    receipt({method:req.method,path:url.pathname,query:url.search,status,ids});
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));
  };
}
if(require.main===module){
  const [runId,file,expectedScriptSHA]=process.argv.slice(2);
  assert.equal(process.platform,'linux');assert.match(runId,/^[a-f0-9-]{36}$/);
  assert.equal(process.env.MTG_ISOLATED_QUALIFICATION_RUN,runId);
  assert.equal(file,'/app/.local-data/catalog-fixture.json');
  assert.equal(digest(fs.readFileSync(__filename)),expectedScriptSHA);
  const input=fs.readFileSync(file),catalog=JSON.parse(input);
  const cards=verifyCatalog(catalog),recordPath='/app/.local-data/catalog-fixture-requests.jsonl';
  const server=http.createServer(handler(cards,r=>fs.appendFileSync(recordPath,JSON.stringify(r)+'\n')));
  server.maxConnections=8;server.requestTimeout=5000;server.headersTimeout=5000;
  server.listen(43127,'127.0.0.1',()=>fs.writeFileSync('/app/.local-data/catalog-fixture-ready.json',JSON.stringify({pid:process.pid,runId,address:server.address(),scriptSHA256:expectedScriptSHA,inputSHA256:digest(input),records:cards.length})));
  process.on('SIGTERM',()=>server.close());
}
module.exports={verifyCatalog,handler};
