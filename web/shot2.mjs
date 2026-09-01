import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", e => errs.push("PAGEERROR " + e.message.slice(0,200)));
await p.goto("http://localhost:4173/", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
// scroll at a human pace so IntersectionObserver and ScrollTrigger both fire
await p.evaluate(async () => {
  const step = 260;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo({ top: y, behavior: "instant" });
    await new Promise(r => setTimeout(r, 260));
  }
  await new Promise(r => setTimeout(r, 900));
  window.scrollTo({ top: 0, behavior: "instant" });
});
await new Promise(r => setTimeout(r, 1600));
await p.screenshot({ path: "../docs/landing.png", fullPage: true });
console.log("errors:", errs.join(" | ") || "none");
await b.close();
