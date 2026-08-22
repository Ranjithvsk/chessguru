import { MongoClient } from "mongodb";
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chessguru";
const UA = "ChessGuruBot/1.0 (+https://chessguru.cc; hello@chessguru.cc)";
async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(q + ", India")}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const arr = await res.json();
  if (!arr || arr.length === 0) return null;
  const r = arr[0]; const a = r.address || {};
  return {
    lat: parseFloat(r.lat), lng: parseFloat(r.lon),
    state: a.state || null,
    district: a.state_district || a.county || a.city_district || null,
    city: a.city || a.town || a.village || a.suburb || null,
    display_name: r.display_name,
  };
}
// Try progressively shorter queries: full → last 3 segments → last 1 segment → city extracted from name via known keywords
function candidates(loc, name) {
  const parts = String(loc || "").split(",").map(s => s.trim()).filter(Boolean);
  const c = [];
  if (parts.length) c.push(parts.join(", "));
  if (parts.length >= 2) c.push(parts.slice(-3).join(", "));
  if (parts.length >= 1) c.push(parts[parts.length - 1]);   // just the last chunk — usually city
  // Also try known Indian city names anywhere in the name string
  const CITIES = ["Chennai","Coimbatore","Madurai","Trichy","Salem","Erode","Tirupur","Vellore","Thanjavur","Cuddalore","Karur","Kanchipuram","Chengalpattu","Thiruvallur","Bengaluru","Bangalore","Mysore","Hyderabad","Kochi","Kollam","Trivandrum","Kozhikode","Thrissur","Mumbai","Pune","Nagpur","Ahmedabad","Surat","Kolkata","Delhi","Noida","Gurgaon","Jaipur","Lucknow","Kanpur","Pudukkottai","Nagercoil","Kanyakumari","Tirunelveli","Sivaganga","Perambalur","Ariyalur","Namakkal","Dindigul","Ramanathapuram"];
  for (const city of CITIES) {
    if ((loc + " " + name).toUpperCase().includes(city.toUpperCase()) && !c.some(x => x.toUpperCase().includes(city.toUpperCase()))) {
      c.push(city);
    }
  }
  return [...new Set(c)];
}
(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const coll = db.collection("tournaments");
  const cursor = coll.find({
    $or: [{ lat: { $exists: false } }, { lat: null }],
    location_raw: { $exists: true, $ne: "" },
  });
  let done=0, ok=0, fail=0;
  const started = Date.now();
  for await (const t of cursor) {
    done++;
    const tries = candidates(t.location_raw, t.name);
    let geo = null;
    for (const q of tries) {
      try {
        geo = await nominatim(q);
        if (geo && Number.isFinite(geo.lat)) break;
      } catch (e) { /* try next */ }
      await new Promise(r => setTimeout(r, 1100));
    }
    if (geo && Number.isFinite(geo.lat)) {
      await coll.updateOne({ _id: t._id }, { $set: { ...geo, geocoded_at: new Date() }, $unset: { geocode_failed: "" } });
      ok++;
      console.log(`  [${done}] ok  ${t.name.slice(0,45)} -> ${geo.district || "?"}, ${geo.state || "?"}`);
    } else {
      await coll.updateOne({ _id: t._id }, { $set: { geocode_failed: true, geocoded_at: new Date() } });
      fail++;
      console.log(`  [${done}] no-hit  ${t.name.slice(0,45)}  (tried ${tries.length}: ${tries.slice(0,3).map(x=>x.slice(0,25)).join(" | ")})`);
    }
    await new Promise(r => setTimeout(r, 1100));
  }
  await client.close();
  console.log(`\n=== ok=${ok} fail=${fail} in ${((Date.now() - started)/1000).toFixed(0)}s ===`);
})();
