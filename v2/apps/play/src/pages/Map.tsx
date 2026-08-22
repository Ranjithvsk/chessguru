// /map — India-centered MapLibre with tournament pins. Only shows tournaments
// that have lat/lng (geocoded by scripts/play-geocode.mjs). Pin popup shows a
// mini card + link to detail page.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import { listTournaments } from "../lib/api";
import type { Tournament } from "../lib/types";
import { RATING, dateShort, rupees } from "../lib/helpers";

// Free OSM raster tiles — no key. If we get heavy traffic we can swap to a
// paid vector-tile provider (MapTiler/Stadia) without touching the rest.
const OSM_STYLE = {
  version: 8 as const,
  sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
  // MapLibre's own demo font endpoint — reliably reachable, no CORS issues,
  // used only for the cluster-count numbers.
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
};

// India bounding box (rough) for initial view.
const INDIA_CENTER: [number, number] = [82, 22];
const INDIA_ZOOM = 4.2;

export default function MapPage() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [rows, setRows] = useState<Tournament[] | null>(null);
  const [selected, setSelected] = useState<Tournament | null>(null);

  useEffect(() => {
    listTournaments({ limit: "400" }).then((d) => {
      setRows((d.rows || []).filter((t: any) => Number.isFinite(t.lat) && Number.isFinite(t.lng)));
    }).catch(() => setRows([]));
  }, []);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapEl.current, style: OSM_STYLE as any,
      center: INDIA_CENTER, zoom: INDIA_ZOOM, minZoom: 3, maxZoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false, timeout: 4000 }, trackUserLocation: false }), "top-right");
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Add pins after both map + data are ready. GeoJSON + a clustered source
  // scales cleanly if we ever have 1000+ tournaments.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !rows) return;
    const install = () => {
      const geojson = {
        type: "FeatureCollection" as const,
        features: rows.map((t) => ({
          type: "Feature" as const,
          properties: { id: t._id, name: t.name, rating: t.rating_type ?? "UNRATED" },
          geometry: { type: "Point" as const, coordinates: [t.lng!, t.lat!] },
        })),
      };
      if (map.getSource("tournaments")) {
        (map.getSource("tournaments") as any).setData(geojson);
      } else {
        map.addSource("tournaments", { type: "geojson", data: geojson, cluster: true, clusterMaxZoom: 8, clusterRadius: 45 });
        // Cluster bubbles
        map.addLayer({
          id: "clusters", type: "circle", source: "tournaments", filter: ["has", "point_count"],
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#fbbf24", 10, "#f472b6", 40, "#a855f7"],
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 40, 32],
            "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,255,255,0.6)",
          },
        });
        // cluster-count symbol layer removed — 3rd-party font glyphs (demotiles /
        // openmaptiles) are unreliable and their 404s pollute the console. The
        // colored, size-varying circles convey the "many here" signal clearly;
        // exact count shows up in the pin popup after user zooms in.
        // Individual pins — colored by rating type
        map.addLayer({
          id: "pins", type: "circle", source: "tournaments", filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["match", ["get", "rating"],
              "FIDE", "#3b82f6", "AICF", "#f97316", "STATE", "#22c55e", /* else */ "#94a3b8"],
            "circle-radius": 8, "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,255,255,0.85)",
          },
        });
        // Click a cluster → zoom to expand
        map.on("click", "clusters", (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0] as any;
          const clusterId = f.properties.cluster_id;
          (map.getSource("tournaments") as any).getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
            if (err) return;
            map.easeTo({ center: f.geometry.coordinates, zoom });
          });
        });
        // Click a pin → open side card
        map.on("click", "pins", (e) => {
          const f = e.features?.[0] as any;
          if (!f) return;
          const id = f.properties.id;
          const t = rows.find((x) => x._id === id);
          if (t) setSelected(t);
        });
        map.on("mouseenter", "pins", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "pins", () => (map.getCanvas().style.cursor = ""));
        map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));
      }
    };
    if (map.isStyleLoaded()) install(); else map.once("load", install);
  }, [rows]);

  const withLatLng = rows?.filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng)).length ?? 0;
  const geoPending = rows && withLatLng === 0;

  return (
    <>
      <Aurora /><Nav />
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="mb-4">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#60a5fa" }}>By location</div>
          <div className="flex items-end justify-between gap-4">
            <h1 className="text-2xl md:text-3xl font-black mt-1">Tournaments map</h1>
            <div className="text-xs opacity-70">{withLatLng} pinned · click a pin for details</div>
          </div>
        </div>
        <div className="relative rounded-2xl overflow-hidden border border-[color:var(--border)]" style={{ height: "70vh", minHeight: 500 }}>
          <div ref={mapEl} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          {selected && (
            <div className="absolute top-3 left-3 max-w-sm w-[calc(100%-24px)] md:w-[380px] rounded-2xl border border-[color:var(--border-strong)] shadow-2xl"
                 style={{ background: "var(--modal-bg)", backdropFilter: "blur(6px)" }}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="rounded-full text-[10px] font-bold px-2.5 py-1"
                        style={{ background: (RATING[selected.rating_type ?? "UNRATED"] ?? RATING.UNRATED).bg }}>
                    {(RATING[selected.rating_type ?? "UNRATED"] ?? RATING.UNRATED).label}
                  </span>
                  <button onClick={() => setSelected(null)} className="opacity-70 hover:opacity-100 text-xl leading-none">×</button>
                </div>
                <div className="font-bold text-sm md:text-base leading-tight mb-1">{selected.name}</div>
                <div className="text-xs opacity-70 mb-2">{selected.organizer_name || "—"}</div>
                <div className="text-xs opacity-90 space-y-1">
                  <div>📅 {dateShort(selected.start_date)}{selected.start_date !== selected.end_date ? ` → ${dateShort(selected.end_date)}` : ""}</div>
                  <div>📍 {[selected.city, selected.district, selected.state].filter(Boolean).join(", ")}</div>
                  {selected.entry_fee_paise != null && <div>🎟️ {rupees(selected.entry_fee_paise)}</div>}
                  {selected.prize_pool_paise != null && <div>🏆 {rupees(selected.prize_pool_paise)}</div>}
                </div>
                <Link to={`/t?id=${encodeURIComponent(selected._id)}`}
                      className="mt-4 block text-center rounded-full py-2 text-black text-sm font-bold"
                      style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>
                  View details →
                </Link>
              </div>
            </div>
          )}
          {geoPending && (
            <div className="absolute inset-0 flex items-center justify-center text-center p-6" style={{ background: "rgba(10,15,28,0.9)" }}>
              <div>
                <img src="/marketing/map-india.webp" className="w-32 h-32 mx-auto rounded-2xl object-cover opacity-90 mb-3" />
                <div className="font-semibold">Geocoding tournaments…</div>
                <div className="text-xs opacity-70 mt-1 max-w-sm mx-auto">The map fills in as our geocoder resolves venues. New tournaments appear within an hour of being added.</div>
              </div>
            </div>
          )}
        </div>

        {/* Legend below */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#3b82f6" }} /> FIDE</div>
          <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#f97316" }} /> AICF</div>
          <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#22c55e" }} /> State</div>
          <div className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-full" style={{ background: "#94a3b8" }} /> Unrated</div>
        </div>
      </main>
      <Footer />
    </>
  );
}
