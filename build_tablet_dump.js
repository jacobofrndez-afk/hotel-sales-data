// build_tablet_dump.js
// Reads urls/<locale>.txt (one URL per line) -> fetches Tablet JSON with browser-like headers
// -> appends each JSON object as a single line to dumps/<locale>.ndjson (NDJSON)

const fs = require("fs");
const path = require("path");

// ENV knobs
const LOCALES = (process.env.LOCALES || "en,fr,es,de,it,pt,ja,zh")
  .split(",").map(s => s.trim()).filter(Boolean);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));  // low to avoid throttling
const RETRIES = Math.max(0, Number(process.env.RETRIES || 2));
const TIMEOUT_MS = Math.max(1, Number(process.env.TIMEOUT_MS || 20000));
const START = Math.max(0, Number(process.env.START || 0));  // skip first N URLs
const LIMIT = Math.max(0, Number(process.env.LIMIT || 0));  // fetch at most N URLs (0 = all)

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.tablethotels.com",
  "Referer": "https://www.tablethotels.com/",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty"
};

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function getIdFromUrl(u){ try { return new URL(u).searchParams.get("property"); } catch { return null; } }
function idFromRecord(rec){
  const qId = rec?.query?.property?.[0];
  if (qId) return String(qId);
  const key = Object.keys(rec?.response || {})[0];
  return key ? String(key) : null;
}

async function fetchJson(url, attempt = 0){
  // small jitter
  await sleep(50 + Math.random()*150);
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), TIMEOUT_MS);
  try{
    const res = await fetch(url, { headers: HEADERS, redirect:"follow", signal: controller.signal });
    clearTimeout(t);
    if(!res.ok){
      const canRetry = res.status>=500 || res.status===429 || (res.status===403 && attempt<RETRIES);
      if (canRetry && attempt<RETRIES){
        await sleep(300*(attempt+1));
        return fetchJson(url, attempt+1);
      }
      return { __error:`HTTP_${res.status}`, url };
    }
    return await res.json();
  }catch(e){
    clearTimeout(t);
    if (attempt < RETRIES){
      await sleep(300*(attempt+1));
      return fetchJson(url, attempt+1);
    }
    return { __error:"NETWORK_OR_TIMEOUT", url, message:e && e.message };
  }
}

function loadExistingIdsNdjson(file){
  const ids = new Set();
  if (!fs.existsSync(file)) return ids;
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines){
    try {
      const rec = JSON.parse(line);
      const id = idFromRecord(rec);
      if (id) ids.add(id);
    } catch {}
  }
  return ids;
}

async function fetchAllToNdjson(urls, outFile, existingIds){
  const stream = fs.createWriteStream(outFile, { flags: "a" });
  let idx = 0, ok = 0, fail = 0;
  const queue = urls.slice();

  async function worker(){
    while(queue.length){
      const url = queue.shift();
      idx++;
      const json = await fetchJson(url);
      if (json && !json.__error){
        const id = idFromRecord(json);
        if (!id || existingIds.has(id)) { /* skip duplicates or unknown */ }
        else {
          stream.write(JSON.stringify(json) + "\n");
          existingIds.add(id);
          ok++;
        }
      } else {
        fail++;
        console.warn("[WARN]", json.__error, json.url);
      }
      if (idx % 100 === 0) console.log(`Fetched ${idx}/${urls.length} (ok=${ok}, fail=${fail})`);
      await sleep(50 + Math.random()*150);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker);
  await Promise.all(workers);
  stream.end();
  console.log(`Done: total=${urls.length}, appended=${ok}, failed=${fail}`);
}

(async ()=>{
  if (!fs.existsSync("dumps")) fs.mkdirSync("dumps", { recursive: true });

  for (const lang of LOCALES){
    const listFile = path.join("urls", `${lang}.txt`);
    if (!fs.existsSync(listFile)) { console.warn(`Skip ${lang}: missing ${listFile}`); continue; }

    let urls = fs.readFileSync(listFile, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (START) urls = urls.slice(START);
    if (LIMIT) urls = urls.slice(0, LIMIT);

    const outFile = path.join("dumps", `${lang}.ndjson`);
    const existingIds = loadExistingIdsNdjson(outFile);

    // Skip ones we already have (delta)
    urls = urls.filter(u => {
      const id = getIdFromUrl(u);
      return id && !existingIds.has(String(id));
    });

    console.log(`Locale ${lang}: ${urls.length} URLs to fetch (skipping ${existingIds.size} already present).`);
    if (!urls.length){ console.log(`Nothing to do for ${lang}.`); continue; }

    await fetchAllToNdjson(urls, outFile, existingIds);
    console.log(`Wrote ${outFile}`);
  }
})().catch(err => { console.error(err); process.exit(1); });
