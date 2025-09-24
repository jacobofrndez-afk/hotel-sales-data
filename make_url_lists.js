// make_url_lists.js
const fs = require("fs");
const https = require("https");

const RESET_URL = "https://raw.githubusercontent.com/jacobofrndez-afk/hotel-sales-data/main/reset_all.json";

// Read from env (workflow can pass these)
const LOCALES = (process.env.LOCALES || "en,fr,es,de,it,pt,ja,zh")
  .split(",").map(s => s.trim()).filter(Boolean);
const ARRIVAL = process.env.ARRIVAL || "2026-01-01";
const LOS = Number(process.env.LOS || 1);

function readResetAll() {
  if (fs.existsSync("reset_all.json")) {
    return Promise.resolve(fs.readFileSync("reset_all.json", "utf8"));
  }
  return new Promise((resolve, reject) => {
    https.get(RESET_URL, (res) => {
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

(async () => {
  const raw = await readResetAll();
  const arr = JSON.parse(raw);
  const ids = arr.map(o => o.objectID ?? o.PropertyId ?? o.id).filter(Boolean);

  if (!fs.existsSync("urls")) fs.mkdirSync("urls");

  for (const lang of LOCALES) {
    const lines = ids.map(id =>
      `https://www.tablethotels.com/bear/property_info?property=${encodeURIComponent(id)}&language=${encodeURIComponent(lang)}&arrival=${ARRIVAL}&los=${LOS}&filters=rate`
    ).join("\n");
    const out = `urls/${lang}.txt`;
    fs.writeFileSync(out, lines, "utf8");
    console.log("Wrote", out, "(", ids.length, "lines )");
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
