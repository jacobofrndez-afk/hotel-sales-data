// make_url_lists.js
const fs = require("fs");
const https = require("https");

const RESET_URL = "https://raw.githubusercontent.com/jacobofrndez-afk/hotel-sales-data/main/reset_all.json";

// Edit locales here (use Tablet’s two-letter codes)
const LOCALES = ["en", "fr", "es", "de", "it", "pt", "ja", "zh"];
const ARRIVAL = "2026-01-01";
const LOS = 1;

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

(async () => {
  const raw = await get(RESET_URL);
  const arr = JSON.parse(raw);

  const ids = arr.map(o => o.objectID ?? o.PropertyId ?? o.id).filter(Boolean);

  for (const lang of LOCALES) {
    const lines = ids.map(id =>
      `https://www.tablethotels.com/bear/property_info?property=${encodeURIComponent(id)}&language=${encodeURIComponent(lang)}&arrival=${ARRIVAL}&los=${LOS}&filters=rate`
    ).join("\n");
    const out = `${lang}_urls.txt`;
    fs.writeFileSync(out, lines, "utf8");
    console.log("Wrote", out, "(", ids.length, "lines )");
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
