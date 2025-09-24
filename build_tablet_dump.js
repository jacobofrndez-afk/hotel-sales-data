// build_tablet_dump.js
// Reads urls/<locale>.txt (one URL per line) → fetches Tablet JSON → writes dumps/<locale>.json (array)

const fs = require("fs");
const https = require("https");
const path = require("path");

// ENV knobs (with sensible defaults)
const LOCALES = (process.env.LOCALES || "en,fr,es,de,it,pt,ja,zh")
  .split(",").map(s => s.trim()).filter(Boolean);
const CONCURRENCY = Number(process.env.CONCURRENCY || 10);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 20000);
const RETRIES = Number(process.env.RETRIES || 2); // total attempts = 1 + RETRIES

const agent = new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJson(url, attempt = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, { agent, timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // drain
        if (attempt < RETRIES && res.statusCode >= 500) {
          return sleep(300 * (attempt + 1)).then(() => resolve(fetchJson(url, attempt + 1)));
        }
        return resolve({ __error: `HTTP_${res.statusCode}`, url });
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          if (attempt < RETRIES) {
            return sleep(300 * (attempt + 1)).then(() => resolve(fetchJson(url, attempt + 1)));
          }
          resolve({ __error: "PARSE_ERROR", url });
        }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("TIMEOUT")); });
    req.on("error", (err) => {
      if (attempt < RETRIES) {
        return sleep(300 * (attempt + 1)).then(() => resolve(fetchJson(url, attempt + 1)));
      }
      resolve({ __error: "NETWORK_ERROR", url, message: err && err.message });
    });
  });
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
