import {chromium} from "@playwright/test";
if(process.env.MTG_BROWSER_LOSS_CHILD!=="1"||process.env.HOME!=="/root")
  throw Error("Only the isolated owned browser container may launch this profile");
const context=await chromium.launchPersistentContext("/profile",{
  headless:true,args:["--remote-debugging-port=9222","--remote-debugging-address=127.0.0.1"],
});
console.log("Owned persistent browser ready");
await new Promise(resolve=>context.once("close",resolve));
