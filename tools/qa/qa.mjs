import { chromium } from "playwright";
import fs from "node:fs"; fs.mkdirSync("./qa-shots", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--no-sandbox"] });
const sizes = [["desk",1440,900,0],["deskS",900,600,0],["deskXS",760,520,0],["tabP",820,1180,1],["tabL",1024,768,1],["port",390,844,1],["land",844,390,1],["tiny",320,568,1],["se",667,375,1]];
let fails = 0;
for (const [n,w,h,m] of sizes) {
  const ctx = await browser.newContext({ viewport:{width:w,height:h}, isMobile:!!m, hasTouch:!!m });
  const page = await ctx.newPage(); const errs=[];
  page.on("pageerror", e=>errs.push(e.message)); page.on("console", x=>{ if(x.type()==="error" && !/WebSocket|ws:|ERR_CONNECTION/.test(x.text())) errs.push(x.text().slice(0,120)); });
  page.on("requestfailed", r=>{ if(!/ws:|socket/.test(r.url())) errs.push("reqfail "+r.url()); });
  await page.goto((process.env.URL || "http://127.0.0.1:4173/")); await page.evaluate(()=>localStorage.clear()); await page.reload();
  const introOk = await page.evaluate(()=>{ const b=document.getElementById("start").getBoundingClientRect(); return b.bottom<=innerHeight && b.top>=0; });
  await page.fill("#player-name","QA"); await page.click("#start"); await page.waitForTimeout(6000);
  const r = await page.evaluate(()=>{
    const W=innerWidth,H=innerHeight, issues=[];
    const tut=document.getElementById("driving-tutorial"); const tr=tut.getBoundingClientRect();
    if (tut.hidden) issues.push("tutorial hidden");
    if (tr.left<0||tr.right>W||tr.top<0||tr.bottom>H) issues.push("tutorial out of viewport");
    const mc=document.getElementById("mobile-controls");
    const ctrls = mc && !mc.hidden ? [...mc.querySelectorAll(".mc-steer-btn,.mc-pedal,.mc-turbo-btn,.mc-turret-btn,.mc-util-btn,.mc-corner-btn")].filter(e=>e.offsetParent&&!e.hidden) : [];
    for (const e of ctrls) { const b=e.getBoundingClientRect(); if (b.width===0) continue;
      if (b.left<-1||b.top<-1||b.right>W+1||b.bottom>H+1) issues.push("OUT "+e.className.split(" ")[1]);
      if (!(b.right<tr.left||b.left>tr.right||b.bottom<tr.top||b.top>tr.bottom)) issues.push("tutorial overlaps "+(e.className.split(" ")[1]||e.className)); }
    if (document.documentElement.scrollHeight>H+1) issues.push("page scrolls "+document.documentElement.scrollHeight);
    return { mode: mc&&!mc.hidden?"touch":"keys", ctrls: ctrls.length, tut:[tr.top,tr.height].map(Math.round), issues };
  });
  if (!introOk) r.issues.push("DRIVE button not fully visible on intro");
  const all=[...r.issues,...errs]; if (all.length) fails++;
  console.log(n, w+"x"+h, r.mode, "controls:"+r.ctrls, "tutTop/H:"+r.tut, all.length? "ISSUES: "+all.join(" | ") : "OK");
  await page.screenshot({ path:`./qa-shots/qa-${n}.png` });
  await ctx.close();
}
console.log("sizes with issues:", fails);
await browser.close(); process.exit(0);
