const http=require('http'),fs=require('fs');
const {cards}=JSON.parse(fs.readFileSync('/review/.local-data/collector-fixture.json'));
const sets=[{code:'tst',name:'Collector test set',set_type:'expansion',digital:false,released_at:'2026-11-07'},...Array.from({length:14},(_,i)=>({code:`e${i}`,name:`Empty set ${String(i).padStart(2,'0')}`,set_type:'memorabilia',digital:false,released_at:'2026-10-01'})),{code:'inc',name:'Incomplete catalog',set_type:'expansion',digital:false,released_at:'2026-09-01'}];
http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
if(url.pathname==='/sets')return res.end(JSON.stringify({object:'list',data:sets,has_more:false}));
const set=(url.searchParams.get('q')||'').match(/set:(\w+)/)?.[1], page=Number(url.searchParams.get('page')||1);
if(set==='tst')return res.end(JSON.stringify({object:'list',total_cards:4,has_more:page===1,data:cards.slice((page-1)*2,page*2)}));
if(set==='inc')return res.end(JSON.stringify({object:'list',total_cards:3,has_more:false,data:[{...cards[0],set}]}));
const reply=()=>res.end(JSON.stringify({object:'list',total_cards:1,has_more:false,data:[{...cards[0],set}]}));
if(['e0','e1','e2'].includes(set)){const timer=setTimeout(reply,5000);res.on('close',()=>clearTimeout(timer));return;}
return reply();
}).listen(14001,'0.0.0.0');

