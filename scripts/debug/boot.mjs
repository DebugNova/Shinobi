// Screenshot of the boot screen as a player sees it (navigator.webdriver spoofed: under automation the boot screen
// skips its key art and leaves). usage: node scripts/debug/boot.mjs [url] [out.png] [atMs=700]
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
await p.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
await p.goto(process.argv[2] || 'http://localhost:3101/', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, +(process.argv[4] || 700)));
await p.screenshot({ path: process.argv[3] || 'shots/boot_art.png' });
await b.close();
