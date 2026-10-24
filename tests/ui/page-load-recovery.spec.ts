import {test,expect} from "@playwright/test";
import {createServer,type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {writeFileSync} from "node:fs";
import {navigatePageRecovery} from "../../lib/page-load-recovery";

test.skip(process.env.MTG_DATABASE_LOSS_TEST!=="1","Runs with the isolated recovery qualification");

test("page recovery after a document POST makes a fresh GET, including fragment history",async({page})=>{
  const traffic:{method:string;url:string}[]=[];
  const server:Server=createServer((req,res)=>{
    const url=new URL(req.url!,"http://127.0.0.1");
    res.setHeader("Content-Type","text/html; charset=utf-8");res.setHeader("Cache-Control","no-store");
    if(url.pathname==="/start"){
      const fragment=url.searchParams.get("fragment");
      const suffix=fragment==="yes"?"#capture-card-2":fragment==="empty"?"#":"";
      res.end(`<form method="POST" action="/failed?batch=contract${suffix}"><button>Create POST document</button></form>`);
      return;
    }
    if(url.pathname!=="/failed"){res.statusCode=404;res.end();return;}
    traffic.push({method:req.method!,url:req.url!});
    // Only trusted checked-in function source is embedded; this executes the
    // actual imported helper rather than a second navigation implementation.
    if(req.method==="POST")res.end(`<h1>Failed POST document</h1><button id="recover">Reload page</button><script>const recover=${navigatePageRecovery.toString()};document.getElementById('recover').onclick=()=>recover(window.location,window.history);</script>`);
    else res.end("<h1>Recovered with GET</h1>");
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const port=(server.address() as AddressInfo).port;
  try{
    for(const fragment of ["no","empty","yes"]){
      const start=traffic.length;
      await page.goto(`http://127.0.0.1:${port}/start?fragment=${fragment}`);
      await page.getByRole("button",{name:"Create POST document",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Failed POST document",exact:true})).toBeVisible();
      expect(new URL(page.url()).hash).toBe(fragment==="yes"?"#capture-card-2":"");
      if(fragment==="empty")expect(page.url().endsWith("#")).toBe(true);
      await page.getByRole("button",{name:"Reload page",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Recovered with GET",exact:true})).toBeVisible();
      expect(traffic.slice(start)).toEqual([{method:"POST",url:"/failed?batch=contract"},{method:"GET",url:"/failed?batch=contract"}]);
      expect(new URL(page.url()).hash).toBe("");
    }
    writeFileSync(test.info().outputPath("post-recovery-traffic.json"),JSON.stringify(traffic));
  }finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});