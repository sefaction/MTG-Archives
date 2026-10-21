const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {verifyCatalog,handler}=require('./recorded-catalog-fixture.cjs');
const catalog=JSON.parse(fs.readFileSync('tests/fixtures/deck-paste-public-catalog.json','utf8'));
function request(path,method='GET',remoteAddress='127.0.0.1'){
  const receipts=[];let status,body;handler(verifyCatalog(catalog),r=>receipts.push(r))(
    {url:path,method,socket:{remoteAddress}},
    {writeHead:s=>status=s,end:b=>body=JSON.parse(b)});
  return {status,body,receipts};
}
test('recorded catalog validates every public identity and hash',()=>assert.equal(verifyCatalog(catalog).length,87));
test('recorded exact alias print returns actual canonical public card',()=>{const r=request('/cards/fca/7');assert.equal(r.status,200);assert.equal(r.body.name,"Bolas's Citadel");assert.equal(r.body.flavor_name,"Kefka's Tower");assert.equal(r.receipts[0].ids[0],'24b2833e-6c08-4f33-8481-f65f2a063c60');});
for(const [path,method,remote,status] of [
  ['/cards/unknown/1','GET','127.0.0.1',404],['/cards/fca/7','POST','127.0.0.1',405],
  ['/cards/fca/7','GET','172.18.0.4',403],['/cards/fca/7?redirect=https://example.com','GET','127.0.0.1',404],
  ['https://example.com/cards/not-known/7','GET','127.0.0.1',404],['/anything','GET','127.0.0.1',404],['https://example.com/cards/fca/7','GET','127.0.0.1',404],
  ['/cards/search?q=anything&order=name&unique=prints','GET','127.0.0.1',404],
])test('recorded fixture refuses '+method+' '+path,()=>assert.equal(request(path,method,remote).status,status));
test('recorded catalog corruption is rejected before serving',()=>{const j=structuredClone(catalog);j.cards[0].name='Invented';assert.throws(()=>verifyCatalog(j));});
test('recorded exact canonical search returns only retained printing',()=>{const r=request('/cards/search?'+new URLSearchParams({q:'name:"Farseek"',order:'name',unique:'prints'}));assert.equal(r.status,200);assert.equal(r.body.data.length,1);assert.equal(r.body.data[0].collector_number,'45');});
