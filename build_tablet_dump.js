// build_tablet_dump.js
// Reads urls/<locale>.txt -> fetches Tablet JSON with browser-like headers -> writes dumps/<locale>.json

const fs = require("fs");
const path = require("path");

// ENV
const LOCALES = (process.env.LOCALES || "en,fr,es,de,it,pt,ja,zh")
  .split(",").map(s => s.trim()).filter(Boolean);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3)); // keep low to avoid blocking
const RETRIES = Math.max(0, Number(process.env.RETRIES || 2));
const TIMEOUT_MS = Math.max(1, Number(process.env.TIMEOUT_MS || 20000));

const HEADERS = {
  // Mimic a normal Chrome request
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.tablethotels.com",
  "Referer": "https://www.tablethotels.com/",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  // Some CDNs look at these (harmless if ignored)
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty"
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, attempt = 0) {
  // small jitter to avoid bursty pattern
  await sleep(50 + Math.random() * 150);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: controller.signal });
    clearTimeout(t);

    if (!res.ok) {
      // Retry only on 5xx or 429; 403 often means blocked — try a couple times anyway
      const canRetry = res.status >= 500 || res.status === 429 || (res.status === 403 && attempt < RETRIES);
      if (canRetry && attempt < RETRIES) {
        await sleep(300 * (attempt + 1));
        return fetchJson(url, attempt + 1);
      }
      return { __error: `HTTP_${res.status}`, url };
    }
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    if (attempt < RETRIES) {
      await sleep(300 * (attempt + 1));
      return fetchJson(url, attempt + 1);
    }
    return { __error: "NETWORK_OR_TIMEOUT", url, message: e && e.message };
  }
}

async function fetchAll(urls) {
  const out = [];
  let idx = 0, ok = 0, fail = 0;
  const queue = urls.slice();

  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      idx++;
      const json = await fetchJson(url);
      if (json && !json.__error) { out.push(json); ok++; }
      else { fail++; console.warn("[WARN]", json.__error, json.url); }
      if (idx % 100 === 0) console.log(`Fetched ${idx}/${urls.length} (ok=${ok}, fail=${fail})`);
      // tiny delay between requests per worker
      await sleep(50 + Math.random() * 150);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker);
  await Promise.all(workers);
  console.log(`Done: total=${urls.length}, ok=${ok}, fail=${fail}`);
  return out;
}

(async () => {
  if (!fs.existsSync("dumps")) fs.mkdirSync("dumps", { recursive: true });

  for (const lang of LOCALES) {
    const listFile = path.join("urls", `${lang}.txt`);
    if (!fs.existsSync(listFile)) { console.warn(`Skip ${lang}: missing ${listFile}`); continue; }

    const urls = fs.readFileSync(listFile, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!urls.length) { console.warn(`Skip ${lang}: ${listFile} is empty`); continue; }

    console.log(`Locale ${lang}: fetching ${urls.length} URLs ...`);
    const records = await fetchAll(urls);

    const outFile = path.join("dumps", `${lang}.json`);
    fs.writeFileSync(outFile, JSON.stringify(records), "utf8");
    console.log(`Wrote ${outFile} (${records.length} records)`);
  }
})().catch(err => { console.error(err); process.exit(1); });
