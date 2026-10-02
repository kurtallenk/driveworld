import { chromium } from "playwright";
import fs from "node:fs"; fs.mkdirSync("./qa-shots", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror", e => errs.push(e.message));
await page.goto((process.env.URL || "http://127.0.0.1:5173/")); await page.evaluate(()=>localStorage.clear()); await page.reload();
await page.fill("#player-name","Rot"); await page.click("#start"); await page.waitForTimeout(6000);
const check = async (label) => {
  const r = await page.evaluate(() => {
    const sel = [".mc-steer-btn--left",".mc-steer-btn--right",".mc-pedal-accel",".mc-pedal-brake",".mc-handbrake-btn",".mc-turbo-btn"];
    const W = innerWidth, H = innerHeight;
    const out = { orient: document.getElementById("mobile-controls").dataset.orientation, scrollY: scrollY, docH: document.documentElement.scrollHeight, H };
    out.ctrls = sel.map(s => { const b = document.querySelector(s).getBoundingClientRect(); return `${s.replace(".mc-","")}:${Math.round(b.width)}x${Math.round(b.height)}${(b.left<0||b.top<0||b.right>W||b.bottom>H)?" OUT!":""}`; });
    return out;
  });
  console.log(label, JSON.stringify(r));
};
await check("portrait");
for (const [w,h,l] of [[844,390,"landscape"],[390,844,"portrait-again"],[667,375,"landscape-se"],[1024,768,"tablet-land"]]) {
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(900); await check(l);
  await page.screenshot({ path: `./qa-shots/rot-${l}.png` });
}
console.log("errors", errs);
await browser.close(); process.exit(0);
