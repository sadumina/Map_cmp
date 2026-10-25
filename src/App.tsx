import { useEffect, useMemo, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import MapView, { type PopulationDetails, type RoadDetails } from "./MapView";
import { TIERS, TIER_COLORS } from "./tokens";
import { parseFloodPriorityCollection, parseRiskCollection } from "./data";
import type { DataLoadState, FloodPriorityCollection, FloodPriorityProperties, Hazard, LayerMode, RiskCollection, RiskFeature, RiskFilters, RiskProps, VisualizationMode } from "./types";
import ResearchLandingPage from "./LandingPage";

const base = import.meta.env.BASE_URL;
type FloodHistoryRow = {
  Date: string; Location: string; Water_Level: number; Rainfall: number;
  Rainfall_3day: number; Rainfall_7day: number; Water_Level_Change: number;
  Severity: string; Predicted_Severity: string;
};
type PopulationArea = PopulationDetails & {
  ds_division?: string;
  district?: string;
};
const floodSeverityScore: Record<string, number> = { "Very Low": 0.1, Low: 0.25, Moderate: 0.5, High: 0.75, "Very High": 1 };
const floodTier = (severity: string) => (severity in floodSeverityScore ? severity : "Moderate") as RiskProps["tier"];

function LandingPage({ onExplore }: { onExplore: () => void }) {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="Risk Atlas home">
          <span className="brand-mark"><span /></span>
          <span>RISK ATLAS</span>
        </a>
        <div className="landing-nav-links">
          <a href="#approach">Approach</a>
          <a href="#signals">Signals</a>
          <button className="nav-cta" onClick={onExplore}>Open the map <span>↗</span></button>
        </div>
      </nav>

      <section className="landing-hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker"><span className="kicker-line" /> DECISION INTELLIGENCE FOR A CHANGING CLIMATE</p>
          <h1>See risk<br /><em>before it moves.</em></h1>
          <p className="hero-description">Risk Atlas turns complex hazard data into a clear, shared picture of what is changing on the ground — so better decisions can happen earlier.</p>
          <div className="hero-actions">
            <button className="primary-cta" onClick={onExplore}>Explore the live map <span>↗</span></button>
            <a className="text-cta" href="#approach">Our approach <span>↓</span></a>
          </div>
          <p className="hero-note"><span className="status-dot" /> Monitoring Sri Lanka · Updated continuously</p>
        </div>

        <div className="hero-visual" aria-label="Animated risk signal visualization">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="visual-grid" />
          <div className="signal signal-a"><i /> FLOOD <b>0.78</b></div>
          <div className="signal signal-b"><i /> LANDSLIDE <b>0.64</b></div>
          <div className="visual-center">
            <span className="center-label">LIVE SIGNAL</span>
            <strong>LK</strong>
            <span className="center-caption">SRI LANKA<br />2024 / 25</span>
          </div>
          <div className="visual-footer"><span>RISK INTENSITY</span><span><i className="legend-blue" /> LOW <i className="legend-orange" /> HIGH</span></div>
        </div>
      </section>

      <section className="landing-proof" id="signals">
        <div className="proof-intro"><span className="section-number">01</span><p>ONE VIEW.<br /><strong>BETTER SIGNAL.</strong></p></div>
        <div className="proof-stat"><strong>24/7</strong><span>situational awareness</span></div>
        <div className="proof-stat"><strong>03</strong><span>layers of context</span></div>
        <div className="proof-stat"><strong>01</strong><span>shared source of truth</span></div>
      </section>

      <section className="approach-section" id="approach">
        <div className="section-heading"><span className="section-number">02</span><h2>Clarity at the<br /><em>moment it matters.</em></h2></div>
        <div className="approach-grid">
          <article className="approach-card"><span className="card-index">01</span><div className="card-icon">◌</div><h3>Understand the terrain</h3><p>See landslide signals grounded in the places and communities they affect.</p><span className="card-arrow">↗</span></article>
          <article className="approach-card featured"><span className="card-index">02</span><div className="card-icon">⌁</div><h3>Find the signal</h3><p>Move from regional patterns to specific locations with a map built for confident exploration.</p><span className="card-arrow">↗</span></article>
          <article className="approach-card"><span className="card-index">03</span><div className="card-icon">◎</div><h3>Act with context</h3><p>Bring together risk, roads, population and elevation to make the next decision more informed.</p><span className="card-arrow">↗</span></article>
        </div>
      </section>

      <section className="landing-bottom">
        <p>Risk is not static.<br /><em>Neither are we.</em></p>
        <button className="primary-cta" onClick={onExplore}>Enter Risk Atlas <span>↗</span></button>
      </section>
      <footer className="landing-footer"><span>© 2025 RISK ATLAS</span><span>BUILT FOR EARLIER ACTION</span><span>SRI LANKA</span></footer>
    </main>
  );
}

function FloodHistoryChart({ rows }: { rows: FloodHistoryRow[] }) {
  if (rows.length < 2) return null;
  const values = rows.map((row) => row.Water_Level);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 180},${36 - ((value - min) / Math.max(max - min, 0.001)) * 28}`).join(" ");
  return <div className="flood-history-chart"><span>Water level over 2025</span><svg viewBox="0 0 180 40" role="img" aria-label="Water level history"><polyline points={points} fill="none" stroke="#35b9e9" strokeWidth="2" /></svg></div>;
}

function formatRoadClass(value?: string) {
  if (!value) return "Road class unavailable";
  return value.charAt(0).toUpperCase() + value.slice(1) + " road";
}

function normalizeAreaName(value?: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function useGeoJSON(name: string): DataLoadState {
  const [data, setData] = useState<RiskCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`${base}data/${name}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
        return response.json();
      })
      .then((value) => { if (active) setData(parseRiskCollection(value, name)); })
      .catch((reason: unknown) => {
        if (active) {
          setData(null);
          setError(reason instanceof Error ? reason.message : `Could not load ${name}.`);
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [name, attempt]);
  return { data, loading, error, retry: () => setAttempt((value) => value + 1) };
}

function useFloodPriority(): { data: FloodPriorityCollection | null; loading: boolean; error: string | null; retry: () => void } {
  const [data, setData] = useState<FloodPriorityCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`${base}data/flood_priority.geojson`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load flood priority areas (${response.status}).`);
        return response.json();
      })
      .then((value) => { if (active) setData(parseFloodPriorityCollection(value, "flood_priority.geojson")); })
      .catch((reason: unknown) => {
        if (active) {
          setData(null);
          setError(reason instanceof Error ? reason.message : "Could not load flood priority areas.");
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  return { data, loading, error, retry: () => setAttempt((value) => value + 1) };
}

function usePopulationAreas(): { data: PopulationArea[]; loading: boolean; error: string | null } {
  const [data, setData] = useState<PopulationArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetch(`${base}data/ds_population.geojson`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load population exposure data (${response.status}).`);
        return response.json() as Promise<{ features?: Array<{ properties?: PopulationArea }> }>;
      })
      .then((value) => {
        const rows = (value.features ?? []).map((feature) => feature.properties).filter((properties): properties is PopulationArea => Boolean(properties));
        if (active) setData(rows);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load population exposure data.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return { data, loading, error };
}

function MapDashboard() {
  const landslideState = useGeoJSON("landslide_real.geojson");
  const floodState = useGeoJSON("flood_real.geojson");
  const landslide = landslideState.data;
  const flood = floodState.data;
  const floodPriorityState = useFloodPriority();
  const floodPriority = floodPriorityState.data;
  const populationAreasState = usePopulationAreas();
  const populationAreas = populationAreasState.data;
  const [mode, setMode] = useState<LayerMode>("both");
  const [selected, setSelected] = useState<RiskProps | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(true);
  const [language, setLanguage] = useState<"en" | "si" | "ta">("en");
  const [visualization, setVisualization] = useState<VisualizationMode>("markers");
  const [terrain, setTerrain] = useState(false);
  const [contours, setContours] = useState(false);
  const [roads, setRoads] = useState(false);
  const [population, setPopulation] = useState(false);
  const [selectedRoad, setSelectedRoad] = useState<RoadDetails | null>(null);
  const [selectedPopulation, setSelectedPopulation] = useState<PopulationDetails | null>(null);
  const [selectedFloodPriority, setSelectedFloodPriority] = useState<FloodPriorityCollection["features"][number]["properties"] | null>(null);
  const [selectedExposure, setSelectedExposure] = useState<PopulationArea | null>(null);
  const [selectedRiskArea, setSelectedRiskArea] = useState<FloodPriorityProperties | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"layers" | "records" | "details" | null>(null);
  const [assessmentTab, setAssessmentTab] = useState<"overview" | "people" | "infrastructure" | "explainability" | "actions">("overview");
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<RiskFilters>({ minScore: 0, maxScore: 1, tiers: [...TIERS], query: "" });
  const [floodHistory, setFloodHistory] = useState<FloodHistoryRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [floodDate, setFloodDate] = useState("");

  useEffect(() => {
    fetch(`${base}data/flood_timeseries_2025.json`)
      .then((response) => { if (!response.ok) throw new Error(`Could not load flood history (${response.status}).`); return response.json() as Promise<FloodHistoryRow[]>; })
      .then((rows) => { setFloodHistory(rows); setFloodDate(rows.reduce((latest, row) => row.Date > latest ? row.Date : latest, "")); })
      .catch((reason: unknown) => setHistoryError(reason instanceof Error ? reason.message : "Could not load flood history."));
  }, []);

  const floodCoordinates = useMemo(() => new Map((flood?.features ?? []).map((feature) => [feature.properties.location ?? "", feature.geometry.coordinates])), [flood]);
  const floodForDate = useMemo<RiskCollection | null>(() => {
    if (!floodHistory.length || !floodDate) return flood;
    const features: RiskFeature[] = floodHistory.filter((row) => row.Date === floodDate).flatMap((row) => {
      const coordinates = floodCoordinates.get(row.Location);
      if (!coordinates) return [];
      const severity = row.Predicted_Severity || row.Severity;
      return [{
        type: "Feature",
        geometry: { type: "Point", coordinates },
        properties: {
          id: `FL-${row.Location.toUpperCase().replace(/ /g, "-")}-${row.Date}`,
          hazard: "flood", score: floodSeverityScore[severity] ?? 0.5, tier: floodTier(severity),
          date: row.Date, demo: false, river: `${row.Location} monitoring point`, location: row.Location,
          water_level: row.Water_Level, rainfall: row.Rainfall, rainfall_3day: row.Rainfall_3day,
          rainfall_7day: row.Rainfall_7day, water_level_change: row.Water_Level_Change,
          severity: row.Severity, predicted_severity: row.Predicted_Severity,
        },
      } as RiskFeature];
    });
    return { type: "FeatureCollection", features };
  }, [floodHistory, floodDate, floodCoordinates, flood]);

  const visible: Hazard[] = mode === "both" ? ["landslide", "flood"] : [mode];
  const features = useMemo(
    () => [...(visible.includes("landslide") ? landslide?.features ?? [] : []), ...(visible.includes("flood") ? floodForDate?.features ?? [] : [])]
      .filter((feature) => {
        const p = feature.properties;
        const query = filters.query.trim().toLowerCase();
        return p.score >= filters.minScore && p.score <= filters.maxScore && filters.tiers.includes(p.tier) &&
          (!query || `${p.id} ${p.hazard} ${p.river ?? ""}`.toLowerCase().includes(query));
      }), [landslide, floodForDate, mode, filters, visible]);
  const counts = TIERS.map((t) => features.filter((f) => f.properties.tier === t).length);
  const anyDemo = [...(landslide?.features ?? []), ...(flood?.features ?? [])].some((f) => f.properties.demo);
  const scenario = landslide?.features.find((feature) => feature.properties.date.startsWith("Scenario:"))?.properties.date.replace("Scenario:", "").trim() ?? "Model output";
  const loading = landslideState.loading || floodState.loading || floodPriorityState.loading || populationAreasState.loading || (!floodHistory.length && !historyError);
  const errors = [landslideState.error, floodState.error, floodPriorityState.error, populationAreasState.error, historyError].filter(Boolean) as string[];
  const selectedAreaExposure = selectedFloodPriority && populationAreas.find((row) =>
    normalizeAreaName(row.district) === normalizeAreaName(selectedFloodPriority.District) &&
    normalizeAreaName(row.ds_division) === normalizeAreaName(selectedFloodPriority.Division)
  );
  const selectedVisible = selected && features.some((feature) => feature.properties.id === selected.id);
  const filteredLandslide = useMemo(() => landslide ? { ...landslide, features: features.filter((feature) => feature.properties.hazard === "landslide") } : null, [landslide, features]);
  const filteredFlood = useMemo(() => floodForDate ? { ...floodForDate, features: features.filter((feature) => feature.properties.hazard === "flood") } : null, [floodForDate, features]);

  useEffect(() => {
    if (selected && !selectedVisible) setSelected(null);
  }, [selected, selectedVisible]);

  const labels = {
    en: { layers: "Layers", relative: "Relative risk", search: "Search locations", score: "Score range", records: "Visible records", provenance: "Data and method", noData: "No records match these filters." },
    si: { layers: "ස්ථර", relative: "සාපේක්ෂ අවදානම", search: "ස්ථාන සොයන්න", score: "ලකුණු පරාසය", records: "පෙනෙන වාර්තා", provenance: "දත්ත සහ ක්‍රමය", noData: "මෙම පෙරහන්වලට ගැලපෙන වාර්තා නැත." },
    ta: { layers: "அடுக்குகள்", relative: "ஒப்பீட்டு ஆபத்து", search: "இடங்களைத் தேடவும்", score: "மதிப்பெண் வரம்பு", records: "காணக்கூடிய பதிவுகள்", provenance: "தரவு மற்றும் முறை", noData: "இந்த வடிப்பான்களுடன் பதிவுகள் இல்லை." },
  }[language];

  function printMap() {
    window.print();
  }

  async function shareMap() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Risk Atlas landslide map", url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareMessage("Map link copied");
      }
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setShareMessage("Could not share the map link.");
    }
  }

  if (loading) return <div className="status-screen" role="status">Loading risk data…</div>;

  return (
    <div className="app" lang={language === "si" ? "si" : language === "ta" ? "ta" : "en"}>
      {errors.length > 0 && <div className="error-banner" role="alert">{errors.join(" ")} <button onClick={() => { landslideState.retry(); floodState.retry(); floodPriorityState.retry(); }}>Retry</button></div>}
      <MapView landslide={filteredLandslide} flood={filteredFlood} floodPriority={floodPriority} selectedFloodPriorityName={selectedFloodPriority?.boundary_name ?? null} mode={mode} visualization={visualization} terrain={terrain} contours={contours} roads={roads} population={population} selectedId={selected?.id ?? null} onSelect={(risk, relatedArea) => { setSelected(risk); setSelectedRiskArea(relatedArea ?? null); if (risk) { setMobilePanel("details"); setSelectedRoad(null); setSelectedPopulation(null); setSelectedFloodPriority(null); setSelectedExposure(null); } }} onRoadSelect={(road) => { setSelectedRoad(road); if (road) { setMobilePanel("details"); setSelected(null); setSelectedRiskArea(null); setSelectedPopulation(null); setSelectedFloodPriority(null); setSelectedExposure(null); } }} onPopulationSelect={(record) => { setSelectedPopulation(record); if (record) { setMobilePanel("details"); setSelected(null); setSelectedRiskArea(null); setSelectedRoad(null); setSelectedFloodPriority(null); setSelectedExposure(null); } }} onFloodPrioritySelect={(area) => { setSelectedFloodPriority(area); setAssessmentTab("overview"); if (area) { setMobilePanel("details"); setSelected(null); setSelectedRiskArea(null); setSelectedRoad(null); setSelectedPopulation(null); setSelectedExposure(null); } }} />

      <header className="topbar card">
        <div className="brand">
          <span className="eyebrow">SRI LANKA · LIVE RISK VIEW</span>
          <strong>Integrated Flood &amp; Landslide Risk System</strong>
        </div>
        <div className="top-stats"><span><b>{features.length}</b> locations</span><span><i className="pulse-dot" /> map ready</span></div>
        <span className="scenario-badge"><span className="scenario-label">SCENARIO</span>{scenario}</span>
        <div className="map-actions" aria-label="Map actions">
          <button onClick={printMap}>Print</button>
          <button onClick={shareMap}>Share</button>
        </div>
        {anyDemo && <span className="demo-badge">DEMO DATA</span>}
        <label className="language">Language <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="en">English</option><option value="si">සිංහල</option><option value="ta">தமிழ்</option></select></label>
      </header>
      <nav className="mobile-map-nav" aria-label="Map tools">
        <button className={mobilePanel === "layers" ? "active" : ""} aria-pressed={mobilePanel === "layers"} onClick={() => setMobilePanel(mobilePanel === "layers" ? null : "layers")}>☰ <span>Layers</span></button>
        <button className={mobilePanel === "records" ? "active" : ""} aria-pressed={mobilePanel === "records"} onClick={() => setMobilePanel(mobilePanel === "records" ? null : "records")}>◉ <span>Records</span></button>
        <button className={mobilePanel === "details" ? "active" : ""} aria-pressed={mobilePanel === "details"} disabled={!selected && !selectedRoad && !selectedPopulation && !selectedFloodPriority} onClick={() => setMobilePanel(mobilePanel === "details" ? null : "details")}>ⓘ <span>Risk info</span></button>
      </nav>
      {shareMessage && <div className="map-toast" role="status" onAnimationEnd={() => setShareMessage(null)}>{shareMessage}</div>}

      <aside className={`left card ${mobilePanel === "layers" ? "mobile-open" : ""}`} aria-label="Map controls">
        <h3>{labels.layers}</h3>
        <div className="switch" role="group" aria-label="Layer">
          {(["landslide", "flood", "both"] as LayerMode[]).map((layer) => <button key={layer} className={mode === layer ? "on" : ""} aria-pressed={mode === layer} onClick={() => setMode(layer)}>{layer === "landslide" ? "Landslide" : layer === "flood" ? "Flood" : "Both"}</button>)}
        </div>
        <h3>View style</h3>
        <div className="view-switch" role="group" aria-label="Map view style">
          {(["markers", "heatmap", "emergency"] as VisualizationMode[]).map((view) => (
            <button key={view} className={visualization === view ? "on" : ""} aria-pressed={visualization === view} onClick={() => setVisualization(view)}>
              {view === "markers" ? "Markers" : view === "heatmap" ? "Heatmap" : "Emergency"}
            </button>
          ))}
        </div>
        {visualization === "emergency" && <p className="focus-note"><span className="pulse-dot" /> Showing High and Very High risk only</p>}
        <label className="field">{labels.search}<input type="search" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="ID, area, river, hazard" /></label>
        {mode !== "landslide" && filters.query.trim() && floodPriority && (
          <div className="area-search-results" aria-label="Flood area search results">
            {floodPriority.features
              .filter((feature) => `${feature.properties.boundary_name} ${feature.properties.District} ${feature.properties.Division}`.toLowerCase().includes(filters.query.trim().toLowerCase()))
              .slice(0, 5)
              .map((feature) => (
                <button key={feature.properties.boundary_name} onClick={() => { setSelectedFloodPriority(feature.properties); setSelectedExposure(null); setAssessmentTab("overview"); setMobilePanel("details"); }}>
                  <span>{feature.properties.boundary_name}</span><small>{feature.properties.priority_level} · {feature.properties.priority_score.toFixed(2)}</small>
                </button>
              ))}
          </div>
        )}
        {floodHistory.length > 0 && <label className="field flood-date-field">Flood date
          <input type="date" min={floodHistory[0].Date} max={floodHistory[floodHistory.length - 1].Date} value={floodDate} onChange={(event) => setFloodDate(event.target.value)} />
        </label>}
        <label className="field">{labels.score}: {filters.minScore.toFixed(2)} – {filters.maxScore.toFixed(2)}
          <input type="range" min="0" max="1" step="0.01" value={filters.minScore} onChange={(event) => setFilters({ ...filters, minScore: Math.min(Number(event.target.value), filters.maxScore) })} />
          <input type="range" min="0" max="1" step="0.01" value={filters.maxScore} onChange={(event) => setFilters({ ...filters, maxScore: Math.max(Number(event.target.value), filters.minScore) })} />
        </label>
        <details className="context-details">
          <summary>Context layers &amp; legend</summary>
          <div className="terrain-tools">
            <label><input type="checkbox" checked={contours} onChange={(event) => setContours(event.target.checked)} /> Elevation contours</label>
            <label><input type="checkbox" checked={terrain} onChange={(event) => setTerrain(event.target.checked)} /> 3D terrain</label>
            <label><input type="checkbox" checked={roads} onChange={(event) => setRoads(event.target.checked)} /> Road network</label>
            <label><input type="checkbox" checked={population} onChange={(event) => setPopulation(event.target.checked)} /> Population exposure</label>
          </div>
          <h3>{labels.relative}</h3>
          <ul className="legend">
            {TIERS.map((t) => (
              <li key={t}><label><input type="checkbox" checked={filters.tiers.includes(t)} onChange={() => setFilters({ ...filters, tiers: filters.tiers.includes(t) ? filters.tiers.filter((tier) => tier !== t) : [...filters.tiers, t] })} /><span className="dot" style={{ background: TIER_COLORS[t] }} />{t}</label></li>
            ))}
          </ul>
          <div className="map-key"><span><i className="key-mark landslide-key" /> Terraced peak <small>modelled slope point</small></span><span><i className="key-mark flood-key" /> Blue dot <small>flood station</small></span><span><i className="river-key" /> Blue line <small>river context</small></span></div>
          <p className="note">Markers show modelled or monitored points. They do not show measured landslide or flood extent; scores rank places and are not probabilities.</p>
        </details>
      </aside>

      {selected && (
        <aside className={`right card ${mobilePanel === "details" ? "mobile-open" : ""}`} aria-live="polite">
          <button className="close" onClick={() => { setSelected(null); setMobilePanel(null); }} aria-label="Close details">×</button>
          <h3>{selected.hazard === "landslide" ? "Landslide" : "Flood"} · {selected.id}</h3>
          <span className="chip" style={{ background: TIER_COLORS[selected.tier] }}>{selected.tier}</span>
          {selected.hazard === "landslide" && selected.date.startsWith("Scenario:") && (
            <p className="detail-scenario"><strong>Scenario</strong>{selected.date.replace("Scenario:", "").trim()}</p>
          )}
          <dl>
            <dt>Relative risk score</dt><dd>{selected.score.toFixed(2)}</dd>
            {selected.score_ordinary !== undefined && (
              <><dt>Ordinary-condition score</dt><dd>{selected.score_ordinary.toFixed(2)}</dd></>
            )}
            {selected.tier_ordinary && (
              <><dt>Ordinary-condition tier</dt><dd><span className="mini-chip" style={{ background: TIER_COLORS[selected.tier_ordinary] }}>{selected.tier_ordinary}</span></dd></>
            )}
            {selected.confidence !== undefined && (
              <><dt>Model confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></>
            )}
            {selected.river && (<><dt>River</dt><dd>{selected.river}</dd></>)}
            {selected.location && (<><dt>Location</dt><dd>{selected.location}</dd></>)}
            {selected.water_level !== undefined && (<><dt>Water level</dt><dd>{selected.water_level.toFixed(2)}</dd></>)}
            {selected.rainfall !== undefined && (<><dt>Rainfall</dt><dd>{selected.rainfall.toFixed(1)} mm</dd></>)}
            {selected.rainfall_3day !== undefined && (<><dt>Rainfall (3 day)</dt><dd>{selected.rainfall_3day.toFixed(1)} mm</dd></>)}
            {selected.rainfall_7day !== undefined && (<><dt>Rainfall (7 day)</dt><dd>{selected.rainfall_7day.toFixed(1)} mm</dd></>)}
            {selected.depth_m !== undefined && (<><dt>Expected depth</dt><dd>{selected.depth_m} m</dd></>)}
            {!selected.date.startsWith("Scenario:") && <><dt>Date</dt><dd>{selected.date}</dd></>}
            {selected.model_version && <><dt>Model version</dt><dd>{selected.model_version}</dd></>}
          </dl>
          {selected.demo && <p className="note">Placeholder values, not model results.</p>}
          {selected.hazard === "landslide" && <p className="note">This is a modelled point for the selected rainfall scenario, not a mapped landslide boundary.</p>}
          {selected.hazard === "flood" && selected.location && <FloodHistoryChart rows={floodHistory.filter((row) => row.Location === selected.location)} />}
          {selected.hazard === "flood" && selectedRiskArea && (
            <button className="assessment-link" onClick={() => { setSelectedFloodPriority(selectedRiskArea); setAssessmentTab("overview"); setSelected(null); }}>
              Open area assessment <span>→</span>
            </button>
          )}
        </aside>
      )}

      {selectedRoad && (
        <aside className={`right card road-details ${mobilePanel === "details" ? "mobile-open" : ""}`} aria-live="polite">
          <button className="close" onClick={() => { setSelectedRoad(null); setMobilePanel(null); }} aria-label="Close road details">×</button>
          <span className="road-kicker">ROAD NETWORK</span>
          <h3>{selectedRoad.name || "Unnamed road"}</h3>
          <span className="road-class">{formatRoadClass(selectedRoad.class)}</span>
          <dl>
            <dt>Road reference</dt><dd>{selectedRoad.ref || "Unavailable"}</dd>
            <dt>Surface</dt><dd>{selectedRoad.surface || "Unavailable"}</dd>
            <dt>Lanes</dt><dd>{selectedRoad.lanes ?? "Unavailable"}</dd>
            <dt>Speed limit</dt><dd>{selectedRoad.maxspeed ? `${selectedRoad.maxspeed} km/h` : "Unavailable"}</dd>
            <dt>Bridge</dt><dd>{selectedRoad.bridge ? "Yes" : "No"}</dd>
            <dt>Tunnel</dt><dd>{selectedRoad.tunnel ? "Yes" : "No"}</dd>
          </dl>
          <p className="note">Road attributes come from OpenStreetMap and may be incomplete or outdated.</p>
        </aside>
      )}

      {selectedPopulation && (
        <aside className={`right card population-details ${mobilePanel === "details" ? "mobile-open" : ""}`} aria-live="polite">
          <button className="close" onClick={() => { setSelectedPopulation(null); setMobilePanel(null); }} aria-label="Close population details">×</button>
          <span className="population-kicker">POPULATION EXPOSURE</span>
          <h3>{selectedPopulation.ds_division || selectedPopulation.shapeName || "DS division"}</h3>
          <p className="note">{selectedPopulation.district}{selectedPopulation.province ? ` · ${selectedPopulation.province}` : ""}</p>
          <dl>
            <dt>Total population</dt><dd>{selectedPopulation.population?.toLocaleString() ?? "Unavailable"}</dd>
            <dt>Male</dt><dd>{selectedPopulation.male?.toLocaleString() ?? "Unavailable"}</dd>
            <dt>Female</dt><dd>{selectedPopulation.female?.toLocaleString() ?? "Unavailable"}</dd>
            <dt>Children (0–14)</dt><dd>{selectedPopulation.children_0_14?.toLocaleString() ?? "Unavailable"}</dd>
            <dt>Elderly (60+)</dt><dd>{selectedPopulation.elderly_60_plus?.toLocaleString() ?? "Unavailable"}</dd>
          </dl>
        </aside>
      )}

      {selectedFloodPriority && (
        <aside className={`right card flood-priority-details ${mobilePanel === "details" ? "mobile-open" : ""}`} aria-live="polite">
          <button className="close" onClick={() => { setSelectedFloodPriority(null); setMobilePanel(null); }} aria-label="Close flood assessment">×</button>
          <span className="assessment-kicker">FLOOD PRIORITY ASSESSMENT</span>
          <h3>{selectedFloodPriority.boundary_name}</h3>
          <p className="note">{selectedFloodPriority.District} · {selectedFloodPriority.Division}</p>
          <div className="assessment-tabs" role="tablist" aria-label="Flood assessment sections">
            {([
              ["overview", "Overview"],
              ["people", "People"],
              ["infrastructure", "Infrastructure"],
              ["explainability", "Explainability"],
              ["actions", "Actions"],
            ] as const).map(([tab, label]) => (
              <button key={tab} role="tab" aria-selected={assessmentTab === tab} className={assessmentTab === tab ? "active" : ""} onClick={() => setAssessmentTab(tab)}>{label}</button>
            ))}
          </div>
          {assessmentTab === "overview" && <>
          <div className="priority-hero">
            <span>Priority level</span>
            <strong>{selectedFloodPriority.priority_level}</strong>
            <b>{selectedFloodPriority.priority_score.toFixed(2)}</b>
          </div>
          <div className="impact-summary">
            <span>HUMAN IMPACT CONTEXT</span>
            {selectedAreaExposure ? (
              <div className="impact-summary-grid">
                <strong>{selectedAreaExposure.population?.toLocaleString() ?? "—"}<small>Total population</small></strong>
                <strong>{selectedAreaExposure.children_0_14?.toLocaleString() ?? "—"}<small>Children</small></strong>
                <strong>{selectedAreaExposure.elderly_60_plus?.toLocaleString() ?? "—"}<small>Elderly</small></strong>
              </div>
            ) : <p>No matching DS population record was found for this area.</p>}
          </div>
          <dl>
            <dt>Verification</dt><dd>{selectedFloodPriority.verification_status}</dd>
            <dt>Name match</dt><dd>{selectedFloodPriority.match_status}</dd>
            <dt>Scenario</dt><dd>{selectedFloodPriority.scenario_type}</dd>
          </dl>
          <p className="assessment-disclaimer">This is a simulated priority assessment. Human exposure, infrastructure, and response recommendations will be added after their source data is verified.</p>
          </>}
          {assessmentTab === "people" && (() => {
            const exposure = selectedExposure ?? selectedAreaExposure;
            return exposure ? (
              <div className="exposure-grid">
                <div><b>{exposure.population?.toLocaleString() ?? "—"}</b><span>Total population</span></div>
                <div><b>{exposure.children_0_14?.toLocaleString() ?? "—"}</b><span>Children (0–14)</span></div>
                <div><b>{exposure.elderly_60_plus?.toLocaleString() ?? "—"}</b><span>Elderly (60+)</span></div>
                <p className="assessment-disclaimer">Population values are DS-division estimates for the selected area. They are not yet an estimate of the number physically exposed to flooding.</p>
              </div>
            ) : <div className="tab-empty"><strong>Human exposure</strong><p>No exact DS-division population match was found for this selected area.</p><span>Check the area name mapping before operational use</span></div>;
          })()}
          {assessmentTab === "infrastructure" && <div className="tab-empty"><strong>Infrastructure risk</strong><p>Hospitals, schools, bridges, and shelters at risk will appear here when infrastructure data is supplied.</p><span>Awaiting infrastructure dataset</span></div>}
          {assessmentTab === "explainability" && <div className="tab-empty"><strong>Explainable prediction</strong><p>Historical impact comparisons and SHAP factor contributions will appear here when model explanation output is available.</p><span>Awaiting model explanation output</span></div>}
          {assessmentTab === "actions" && <div className="tab-empty"><strong>Decision support</strong><p>Preliminary recommendations will be shown here after the underlying exposure and infrastructure evidence is verified.</p><span>Not an operational recommendation</span></div>}
        </aside>
      )}

      <section className="tiles">
        {TIERS.map((t, i) => (
          <div key={t} className="tile card"><span className="dot" style={{ background: TIER_COLORS[t] }} /><b>{counts[i]}</b><small>{t}</small></div>
        ))}
      </section>

      <section className="summary card" aria-live="polite"><b>{features.length}</b> {labels.records}<span>{mode === "both" ? `${landslide?.features.length ?? 0} landslide · ${flood?.features.length ?? 0} flood` : mode === "flood" ? "Flood monitoring points" : "Landslide locations"}</span></section>

      <section className={`records card ${mobilePanel === "records" ? "mobile-open" : ""}`} aria-label="Risk locations">
        <h3>{labels.records}</h3>
        {features.length === 0 ? <p className="note">{labels.noData}</p> : <ul>{features.slice(0, 12).map((feature) => <li key={`${feature.properties.hazard}-${feature.properties.id}`}><button onClick={() => { setSelected(feature.properties); setMobilePanel("details"); }}><span className="dot" style={{ background: feature.properties.hazard === "flood" ? "#35b9e9" : TIER_COLORS[feature.properties.tier] }} />{feature.properties.location ?? feature.properties.id}<small>{feature.properties.hazard} · {feature.properties.date}</small></button></li>)}</ul>}
        {floodForDate?.features.length ? <div className="flood-table-wrap"><h3>Flood readings · {floodDate}</h3><table className="flood-table"><thead><tr><th>Location</th><th>Severity</th><th>Rain</th></tr></thead><tbody>{floodForDate.features.map((feature) => <tr key={feature.properties.id}><td>{feature.properties.location}</td><td>{feature.properties.predicted_severity}</td><td>{feature.properties.rainfall?.toFixed(1)} mm</td></tr>)}</tbody></table><small className="flood-table-note">Daily history: {floodHistory.length.toLocaleString()} records from 2025. Points are monitoring locations, not flood extents.</small></div> : null}
      </section>

      <section className="limits card">
        <button onClick={() => setLimitsOpen(!limitsOpen)}>Limits {limitsOpen ? "▾" : "▸"}</button>
        {limitsOpen && (
          <ul>
            <li>Landslide records come mostly from one storm.</li>
            <li>Scores rank places and are not real-world probabilities.</li>
            <li>Human-factor data is not included yet.</li>
          </ul>
        )}
      </section>
      <section className="provenance card"><h3>{labels.provenance}</h3><p className="note">Landslide data: <code>public/data/landslide_real.geojson</code>. Flood data: <code>public/data/flood_real.geojson</code>, with daily history in <code>public/data/flood_timeseries_2025.json</code>. Flood points use approximate coordinates for named monitoring locations.</p></section>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<ResearchLandingPage />} />
        <Route path="/map" element={<MapDashboard />} />
      </Routes>
    </HashRouter>
  );
}
