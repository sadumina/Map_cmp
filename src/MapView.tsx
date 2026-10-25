import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_STYLE, INITIAL_VIEW, TIERS, TIER_COLORS } from "./tokens";
import type { FloodPriorityCollection, FloodPriorityProperties, LayerMode, RiskCollection, RiskProps, VisualizationMode } from "./types";

interface Props {
  landslide: RiskCollection | null;
  flood: RiskCollection | null;
  mode: LayerMode;
  selectedId: string | null;
  visualization: VisualizationMode;
  terrain: boolean;
  contours: boolean;
  roads: boolean;
  population: boolean;
  onSelect: (p: RiskProps | null, relatedArea?: FloodPriorityProperties) => void;
  onRoadSelect: (road: RoadDetails | null) => void;
  onPopulationSelect: (population: PopulationDetails | null) => void;
  floodPriority: FloodPriorityCollection | null;
  selectedFloodPriorityName: string | null;
  onFloodPrioritySelect: (area: FloodPriorityCollection["features"][number]["properties"] | null) => void;
}

export interface RoadDetails {
  name?: string;
  ref?: string;
  class?: string;
  surface?: string;
  lanes?: number | string;
  maxspeed?: number | string;
  bridge?: string | boolean;
  tunnel?: string | boolean;
}

export interface PopulationDetails {
  shapeName?: string;
  province?: string;
  district?: string;
  ds_division?: string;
  population?: number;
  male?: number;
  female?: number;
  children_0_14?: number;
  elderly_60_plus?: number;
}

const colorMatch = (): maplibregl.ExpressionSpecification =>
  ["match", ["get", "tier"], ...TIERS.flatMap((t) => [t, TIER_COLORS[t]]), "#888888"] as unknown as maplibregl.ExpressionSpecification;

type Ring = number[][];

function mapFitPadding() {
  if (typeof window !== "undefined" && window.innerWidth <= 760) {
    return { top: 112, right: 24, bottom: 220, left: 24 };
  }
  return { top: 110, right: 350, bottom: 140, left: 300 };
}

function pointInRing(point: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    const intersects = (y > point[1]) !== (previousY > point[1]) &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: [number, number], coordinates: number[][][]): boolean {
  return pointInRing(point, coordinates[0]) &&
    coordinates.slice(1).every((ring) => !pointInRing(point, ring));
}

function pointInFloodArea(point: [number, number], feature: FloodPriorityCollection["features"][number]): boolean {
  const coordinates = feature.geometry.coordinates;
  if (feature.geometry.type === "Polygon") return pointInPolygon(point, coordinates as number[][][]);
  return (coordinates as number[][][][]).some((polygon) => pointInPolygon(point, polygon));
}

class HomeControl implements maplibregl.IControl {
  private container?: HTMLElement;
  onAdd(map: maplibregl.Map) {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-home-control";
    button.title = "Reset map view";
    button.setAttribute("aria-label", "Reset map view");
    button.textContent = "⌂";
    button.addEventListener("click", () => map.flyTo({ ...INITIAL_VIEW, essential: true }));
    this.container.appendChild(button);
    return this.container;
  }
  onRemove() {
    this.container?.remove();
    this.container = undefined;
  }
}

function markerImage(kind: "flood" | "landslide"): ImageData {
  const size = 32;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  if (kind === "flood") {
    // A dotted ring reads as an expanding water footprint and remains visible at low zoom.
    for (let i = 0; i < 12; i += 1) {
      const angle = (Math.PI * 2 * i) / 12;
      g.beginPath();
      g.arc(size / 2 + Math.cos(angle) * 10, size / 2 + Math.sin(angle) * 10, 2.1, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath(); g.arc(size / 2, size / 2, 3, 0, Math.PI * 2); g.fill();
  } else {
    // A terraced triangle makes landslide locations distinct from flood footprints.
    g.beginPath(); g.moveTo(16, 4); g.lineTo(28, 27); g.lineTo(4, 27); g.closePath(); g.fill();
    g.strokeStyle = "#111820"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(9, 22); g.quadraticCurveTo(16, 17, 23, 22); g.stroke();
    g.beginPath(); g.moveTo(12, 17); g.quadraticCurveTo(16, 14, 20, 17); g.stroke();
  }
  return g.getImageData(0, 0, size, size);
}

export default function MapView({ landslide, flood, mode, selectedId, visualization, terrain, contours, roads, population, onSelect, onRoadSelect, onPopulationSelect, floodPriority, selectedFloodPriorityName, onFloodPrioritySelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const latest = useRef({ landslide, flood, floodPriority, mode, selectedId, visualization, terrain, contours, roads, population });
  latest.current = { landslide, flood, floodPriority, mode, selectedId, visualization, terrain, contours, roads, population };
  const pulseFrame = useRef<number | null>(null);
  const fittedData = useRef(false);
  const [coordinates, setCoordinates] = useState<[number, number] | null>(null);

  // create the map once
  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({ container: box.current, style: BASEMAP_STYLE, ...INITIAL_VIEW });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    map.addControl(new HomeControl(), "bottom-right");
    map.addControl(new maplibregl.FullscreenControl(), "bottom-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => {
      map.addImage("flood-marker", markerImage("flood"), { sdf: true });
      map.addImage("landslide-marker", markerImage("landslide"), { sdf: true });
      const empty = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;
      map.addSource("landslide", { type: "geojson", data: empty });
      map.addSource("flood", { type: "geojson", data: empty });
      map.addSource("selected", { type: "geojson", data: empty });
      map.addSource("terrain-dem", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium",
      });
      map.addSource("contours", { type: "geojson", data: `${import.meta.env.BASE_URL}data/terrain_contours.geojson` });
      map.addSource("roads", {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution: "© OpenStreetMap contributors · © OpenFreeMap",
      });
      map.addSource("population", { type: "geojson", data: `${import.meta.env.BASE_URL}data/ds_population.geojson` });
      map.addSource("flood-priority", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "flood-priority-fill", type: "fill", source: "flood-priority",
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["match", ["get", "priority_level"], "High", "#f03b20", "Moderate", "#f7c65c", "Low", "#4aa3df", "#bd0026"],
          "fill-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "flood-priority-outline", type: "line", source: "flood-priority",
        layout: { visibility: "none" },
        paint: { "line-color": "#ffb36b", "line-width": 1.5, "line-opacity": 0.72 },
      });
      map.addLayer({
        id: "contour-layer", type: "line", source: "contours",
        layout: { visibility: "none" },
        paint: { "line-color": "rgba(110, 194, 177, 0.42)", "line-width": 1, "line-opacity": 0.5 },
      });
      map.addLayer({
        id: "roads-casing", type: "line", source: "roads", "source-layer": "transportation",
        layout: { visibility: "none" },
        minzoom: 5,
        filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
        paint: {
          "line-color": "rgba(8, 13, 18, 0.82)",
          "line-opacity": 0.8,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 9, 3.5, 14, 9],
        },
      });
      map.addLayer({
        id: "river-context", type: "line", source: "roads", "source-layer": "waterway",
        minzoom: 5,
        paint: { "line-color": "#35b9e9", "line-opacity": 0.72, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 10, 1.8, 14, 3.5] },
      });
      map.addLayer({
        id: "roads-layer", type: "line", source: "roads", "source-layer": "transportation",
        layout: { visibility: "none" },
        minzoom: 5,
        filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
        paint: {
          "line-color": ["match", ["get", "class"],
            "motorway", "#ff8b5c", "trunk", "#ffad63", "primary", "#f5c76b",
            "secondary", "#d7dce2", "tertiary", "#aeb8c4", "minor", "#8694a3",
            "service", "#647384", "#647384"],
          "line-opacity": 0.86,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.45, 9, 1.4, 14, 5.5],
        },
      });
      map.addLayer({
        id: "roads-hit", type: "line", source: "roads", "source-layer": "transportation",
        layout: { visibility: "none" },
        minzoom: 5,
        filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
        paint: { "line-color": "#ffffff", "line-opacity": 0, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 8, 14, 18] },
      });
      map.addLayer({
        id: "population-layer", type: "fill", source: "population",
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["interpolate", ["linear"], ["get", "population"], 10000, "#334155", 50000, "#4aa3df", 100000, "#f7c65c", 200000, "#f03b20"],
          "fill-opacity": 0.42,
        },
      });
      map.addLayer({
        id: "population-outline", type: "line", source: "population",
        layout: { visibility: "none" },
        paint: { "line-color": "#ffe7a3", "line-opacity": 0.65, "line-width": 1 },
      });
      map.addLayer({
        id: "landslide-heatmap", type: "heatmap", source: "landslide",
        maxzoom: 13,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 0, 0.15, 1, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 7, 0.8, 13, 2.2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 7, 18, 13, 34],
          "heatmap-opacity": 0.78,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.25, "#4aa3df", 0.5, "#fd8d3c", 0.78, "#f03b20", 1, "#bd0026"],
        },
      });
      map.addLayer({
        id: "flood-heatmap", type: "heatmap", source: "flood",
        maxzoom: 13,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 0, 0.15, 1, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 7, 0.8, 13, 2.2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 7, 18, 13, 34],
          "heatmap-opacity": 0.7,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.2, "#b8efff", 0.45, "#5bd0ee", 0.72, "#168bc1", 1, "#075985"],
        },
      });
      map.addLayer({
        id: "landslide-layer", type: "symbol", source: "landslide",
        layout: { "icon-image": "landslide-marker", "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.55, 12, 0.8], "icon-allow-overlap": true },
        paint: { "icon-color": colorMatch(), "icon-halo-color": "#111820", "icon-halo-width": 1 },
      });
      map.addLayer({
        id: "flood-layer", type: "circle", source: "flood",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "score"], 0, 5, 1, 11],
          "circle-color": ["interpolate", ["linear"], ["get", "score"], 0, "#b8efff", 0.5, "#35b9e9", 1, "#075985"],
          "circle-stroke-color": "#e8fbff", "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "selected-layer", type: "circle", source: "selected",
        paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#4aa3df", "circle-stroke-width": 3 },
      });

      ["landslide-layer", "flood-layer"].forEach((id) => {
        map.on("click", id, (e) => {
          const f = e.features?.[0];
          if (f) {
            const relatedArea = id === "flood-layer"
              ? latest.current.floodPriority?.features.find((area) => pointInFloodArea([e.lngLat.lng, e.lngLat.lat], area))?.properties
              : undefined;
            onSelect(f.properties as unknown as RiskProps, relatedArea);
          }
        });
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      });
      map.on("click", "roads-hit", (e) => {
        const properties = e.features?.[0]?.properties;
        if (properties) onRoadSelect(properties as RoadDetails);
      });
      map.on("click", "population-layer", (e) => {
        const properties = e.features?.[0]?.properties;
        if (properties) onPopulationSelect(properties as PopulationDetails);
      });
      map.on("click", "flood-priority-fill", (e) => {
        const properties = e.features?.[0]?.properties;
        if (properties) onFloodPrioritySelect(properties as FloodPriorityCollection["features"][number]["properties"]);
      });
      map.on("mouseenter", "flood-priority-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "flood-priority-fill", () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", "population-layer", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "population-layer", () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", "roads-hit", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "roads-hit", () => (map.getCanvas().style.cursor = ""));
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["landslide-layer", "flood-layer"] });
        const roadHit = map.queryRenderedFeatures(e.point, { layers: ["roads-hit"] });
        const populationHit = map.queryRenderedFeatures(e.point, { layers: ["population-layer"] });
        const floodPriorityHit = map.queryRenderedFeatures(e.point, { layers: ["flood-priority-fill"] });
        if (hit.length === 0 && roadHit.length === 0 && populationHit.length === 0 && floodPriorityHit.length === 0) {
          onSelect(null);
          onRoadSelect(null);
          onPopulationSelect(null);
          onFloodPrioritySelect(null);
        }
      });
      map.on("mousemove", (e) => setCoordinates([e.lngLat.lng, e.lngLat.lat]));

      ready.current = true;
      animateFloodPulse();
      sync();
    });

    return () => {
      if (pulseFrame.current !== null) cancelAnimationFrame(pulseFrame.current);
      map.remove(); mapRef.current = null; ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const { landslide, flood, mode, selectedId, visualization, terrain, contours, roads, population } = latest.current;
    if (landslide) (map.getSource("landslide") as maplibregl.GeoJSONSource).setData(landslide as unknown as GeoJSON.FeatureCollection);
    if (flood) (map.getSource("flood") as maplibregl.GeoJSONSource).setData(flood as unknown as GeoJSON.FeatureCollection);
    if (floodPriority) (map.getSource("flood-priority") as maplibregl.GeoJSONSource).setData(floodPriority as unknown as GeoJSON.FeatureCollection);
    const markersVisible = visualization === "markers" || visualization === "emergency";
    const landslideVisibility = mode === "flood" || !markersVisible ? "none" : "visible";
    const floodVisibility = mode === "landslide" || !markersVisible ? "none" : "visible";
    map.setLayoutProperty("landslide-layer", "visibility", landslideVisibility);
    map.setLayoutProperty("flood-layer", "visibility", floodVisibility);
    map.setLayoutProperty("flood-priority-fill", "visibility", floodPriority && (mode === "flood" || mode === "both") ? "visible" : "none");
    map.setLayoutProperty("flood-priority-outline", "visibility", floodPriority && (mode === "flood" || mode === "both") ? "visible" : "none");
    const priorityFilter: maplibregl.FilterSpecification | null = selectedFloodPriorityName
      ? ["==", ["get", "boundary_name"], selectedFloodPriorityName]
      : null;
    map.setFilter("flood-priority-fill", priorityFilter);
    map.setFilter("flood-priority-outline", priorityFilter);
    map.setLayoutProperty("river-context", "visibility", mode === "landslide" ? "none" : "visible");
    map.setLayoutProperty("landslide-heatmap", "visibility", "none");
    map.setLayoutProperty("flood-heatmap", "visibility", "none");
    map.setLayoutProperty("contour-layer", "visibility", contours && mode !== "flood" ? "visible" : "none");
    ["roads-casing", "roads-layer", "roads-hit"].forEach((id) => map.setLayoutProperty(id, "visibility", roads ? "visible" : "none"));
    ["population-layer", "population-outline"].forEach((id) => map.setLayoutProperty(id, "visibility", population ? "visible" : "none"));
    map.setTerrain(terrain ? { source: "terrain-dem", exaggeration: 1.35 } : null);
    const emergencyFilter: maplibregl.FilterSpecification = ["match", ["get", "tier"], ["High", "Very High"], true, false];
    ["landslide-layer", "flood-layer"].forEach((id) => {
      map.setFilter(id, visualization === "emergency" ? emergencyFilter : null);
    });
    const all = [...(landslide?.features ?? []), ...(flood?.features ?? [])];
    const sel = all.filter((f) => f.properties.id === selectedId);
    (map.getSource("selected") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: sel } as unknown as GeoJSON.FeatureCollection);
  }

  function animateFloodPulse() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const phase = (Date.now() % 3600) / 3600;
    const wave = (Math.sin(phase * Math.PI * 2) + 1) / 2;
    pulseFrame.current = requestAnimationFrame(animateFloodPulse);
  }

  // push data / switch / selection changes into the map
  useEffect(() => { sync(); }, [landslide, flood, floodPriority, selectedFloodPriorityName, mode, selectedId, visualization, terrain, contours, roads, population]);

  useEffect(() => {
    if (!selectedId) return;
    const feature = [...(landslide?.features ?? []), ...(flood?.features ?? [])].find((item) => item.properties.id === selectedId);
    if (feature) mapRef.current?.flyTo({ center: feature.geometry.coordinates, zoom: 11, essential: true });
  }, [selectedId, landslide, flood]);

  useEffect(() => {
    if (!selectedFloodPriorityName || !floodPriority) return;
    const feature = floodPriority.features.find((item) => item.properties.boundary_name === selectedFloodPriorityName);
    if (!feature) return;
    const bounds = new maplibregl.LngLatBounds();
    const coordinates = feature.geometry.coordinates;
    const visit = (value: number[] | number[][] | number[][][] | number[][][][]): void => {
      if (typeof value[0] === "number") {
        bounds.extend(value as [number, number]);
        return;
      }
      (value as Array<number[] | number[][] | number[][][] >).forEach(visit);
    };
    visit(coordinates);
    if (!bounds.isEmpty()) mapRef.current?.fitBounds(bounds, { padding: mapFitPadding(), maxZoom: 10, essential: true });
  }, [selectedFloodPriorityName, floodPriority]);

  useEffect(() => {
    const map = mapRef.current;
    if (fittedData.current || !map || !landslide || landslide.features.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    landslide.features.forEach((feature) => bounds.extend(feature.geometry.coordinates));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: mapFitPadding(), maxZoom: 11, duration: 0 });
      fittedData.current = true;
    }
  }, [landslide]);

  return (
    <div ref={box} className="map">
      {coordinates && <div className="coordinate-readout" aria-live="polite">{coordinates[1].toFixed(5)}°, {coordinates[0].toFixed(5)}°</div>}
    </div>
  );
}
