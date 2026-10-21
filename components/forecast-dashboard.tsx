"use client";

import {
  Activity, Bookmark, Check, ChevronDown, ChevronRight, Cloud, Navigation,
  Compass, Info, LocateFixed, MapPin, Menu, Moon, RefreshCw, Search,
  Settings2, Sun, X, Wifi, WifiOff, Sunrise, Sunset,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentLocation, getDefaultLocation, loadForecast, readCachedForecast, searchLocations, writeCachedForecast } from "@/lib/api";
import type { ForecastDay, ForecastPayload, Location, LocationSuggestion, ShootMode, Units } from "@/lib/api/types";
import { getSkyPotential, recommendTomorrow } from "@/lib/api/recommendation";

const modes: Array<{ id: ShootMode; label: string }> = [
  { id: "landscape", label: "Landscape" }, { id: "portrait", label: "Portrait" },
  { id: "street", label: "Street" }, { id: "astro", label: "Astro" },
  { id: "drone", label: "Drone" }, { id: "wildlife", label: "Wildlife" },
];

type Theme = "daylight" | "darkroom" | "astro";

function temperature(value: number | null, units: Units): string {
  if (value === null) return "—";
  const converted = units === "imperial" ? Math.round(value * 9 / 5 + 32) : Math.round(value);
  return `${converted}°`;
}

function speed(value: number | null, units: Units): string {
  if (value === null) return "—";
  const converted = units === "imperial" ? Math.round(value * 0.621371) : Math.round(value);
  return `${converted} ${units === "imperial" ? "mph" : "km/h"}`;
}

function clockLabel(value: string | null, twelveHour = true): string {
  if (!value) return "—";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (!twelveHour) return `${hourText}:${minute}`;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function clockRange(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const startLabel = clockLabel(start);
  const endLabel = clockLabel(end);
  return startLabel.slice(-2) === endLabel.slice(-2)
    ? `${startLabel.replace(/ (AM|PM)$/, "")}–${endLabel}`
    : `${startLabel}–${endLabel}`;
}

function hourValue(value: string | null): number {
  if (!value) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function dayLabel(date: string, timezone: string, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(target));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  const localNoon = new Date(target + (target - represented));
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(localNoon);
}

function compassDirection(azimuth: number | null): string {
  if (typeof azimuth !== "number" || !Number.isFinite(azimuth)) return "—";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(azimuth / 45) % 8];
}

function compassAngle(azimuth: number | null): number {
  return typeof azimuth === "number" && Number.isFinite(azimuth) ? azimuth : 0;
}

function compassDirectionName(azimuth: number | null): string {
  const direction = compassDirection(azimuth);
  const names: Record<string, string> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };
  return names[direction] ?? "—";
}

function shortWeatherDescription(code: number | null): string {
  if (code === null) return "—";
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 95 && code <= 99) return "Storm";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 51 && code <= 67) return "Rain";
  return "—";
}

function cloudAmountDescription(value: number | null): string {
  if (value === null) return "No cloud reading";
  if (value < 15) return "Very few clouds";
  if (value < 40) return "Some clouds";
  if (value < 70) return "Lots of clouds";
  return "Mostly covered";
}

function useEscape(onClose: () => void, active: boolean) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")) : [];
    focusable[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !dialog) return;
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      opener?.focus();
    };
  }, [active]);
}

function LightTimeline({ day, timezone, activeWindow, onSelectWindow }: {
  day: ForecastDay; timezone: string; activeWindow: string; onSelectWindow: (window: string) => void;
}) {
  const width = 900;
  const height = 190;
  const left = 20;
  const right = 880;
  const top = 18;
  const baseline = 138;
  const xAt = (clock: string | null) => left + (hourValue(clock) / 1440) * (right - left);
  const sunUp = hourValue(day.sunrise);
  const sunDown = hourValue(day.sunset);
  const hours = day.hours.filter((hour) => Number(hour.time.slice(11, 13)) % 2 === 0);
  const points = hours.map((hour) => {
    const minutes = Number(hour.time.slice(11, 13)) * 60;
    const progress = sunDown === sunUp ? 0 : (minutes - sunUp) / (sunDown - sunUp);
    const solar = progress < 0 || progress > 1 ? 0 : Math.sin(Math.PI * progress);
    const cloudFactor = 0.62 + (100 - (hour.cloudCover ?? 40)) / 270;
    return { x: left + (minutes / 1440) * (right - left), y: baseline - solar * cloudFactor * 96 };
  });
  const curve = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${curve} L ${right} ${baseline} L ${left} ${baseline} Z`;
  const firstLight = xAt(day.solar.dawn);
  const sunrise = xAt(day.sunrise);
  const morningGoldEnd = xAt(day.solar.goldenHourEnd);
  const eveningGoldStart = xAt(day.solar.goldenHour);
  const sunset = xAt(day.sunset);
  const dusk = xAt(day.solar.dusk);
  const noon = xAt(day.solar.solarNoon);
  const labels = ["12 AM", "4 AM", "8 AM", "12 PM", "4 PM", "8 PM", "12 AM"];

  return (
    <div className="timeline-wrap">
      <div className="timeline-event-row" aria-label="Solar events">
        <span><Sunrise size={14} aria-hidden="true" /> <b>Sunrise</b> {clockLabel(day.sunrise)}</span>
        <span><Sun size={14} aria-hidden="true" /> <b>Solar noon</b> {clockLabel(day.solar.solarNoon)}</span>
        <span><Sunset size={14} aria-hidden="true" /> <b>Sunset</b> {clockLabel(day.sunset)}</span>
      </div>
      <div className="timeline-chart" role="group" aria-label={`Light trace for ${dayLabel(day.date, timezone)}`}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="timeline-title timeline-desc" preserveAspectRatio="none">
          <title id="timeline-title">Tomorrow’s daylight and shooting windows</title>
          <desc id="timeline-desc">A 24-hour light curve. Amber bands show golden hour, pale bands show blue hour, and the highlighted window is the best time for {activeWindow.toLowerCase()} photography.</desc>
          <defs>
            <linearGradient id="lightFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".16" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[38, 72, 106, baseline].map((y) => <line key={y} className="chart-rule" x1={left} y1={y} x2={right} y2={y} />)}
          <path d={area} fill="url(#lightFill)" />
          <rect x={firstLight} y={top} width={Math.max(0, sunrise - firstLight)} height={baseline - top} className="blue-band" />
          <rect x={sunrise} y={top} width={Math.max(0, morningGoldEnd - sunrise)} height={baseline - top} className="gold-band" />
          <rect x={eveningGoldStart} y={top} width={Math.max(0, sunset - eveningGoldStart)} height={baseline - top} className="gold-band" />
          <rect x={sunset} y={top} width={Math.max(0, dusk - sunset)} height={baseline - top} className="blue-band" />
          {activeWindow === "First light" && <rect x={sunrise} y={top} width={Math.max(1, morningGoldEnd - sunrise)} height={baseline - top} className="recommended-band" />}
          {activeWindow === "Last light" && <rect x={eveningGoldStart} y={top} width={Math.max(1, sunset - eveningGoldStart)} height={baseline - top} className="recommended-band" />}
          <line x1={left} y1={baseline} x2={right} y2={baseline} className="chart-baseline" />
          <path d={curve} fill="none" className="light-curve" />
          {[{ x: sunrise, label: "RISE" }, { x: noon, label: "NOON" }, { x: sunset, label: "SET" }].map((event) => (
            <g key={event.label}>
              <line x1={event.x} y1={top} x2={event.x} y2={baseline} className="event-marker" />
              <text x={event.x} y="12" textAnchor="middle" className="event-label">{event.label}</text>
            </g>
          ))}
          {labels.map((label, index) => <text key={`${label}-${index}`} x={left + (index / 6) * (right - left)} y="166" textAnchor={index === 0 ? "start" : index === 6 ? "end" : "middle"} className="time-label">{label}</text>)}
        </svg>
      </div>
      <div className="timeline-legend">
        <button className={activeWindow === "First light" ? "legend-item legend-selected" : "legend-item"} onClick={() => onSelectWindow("First light")}>
          <span className="legend-swatch legend-gold" /> First light <b>{clockLabel(day.sunrise)}–{clockLabel(day.solar.goldenHourEnd)}</b>
        </button>
        <button className={activeWindow === "Last light" ? "legend-item legend-selected" : "legend-item"} onClick={() => onSelectWindow("Last light")}>
          <span className="legend-swatch legend-gold" /> Last light <b>{clockLabel(day.solar.goldenHour)}–{clockLabel(day.sunset)}</b>
        </button>
        <span className="legend-item legend-static"><span className="legend-swatch legend-blue" /> Blue hour</span>
        <span className="legend-current">Best window · {activeWindow}</span>
      </div>
    </div>
  );
}

export default function ForecastDashboard() {
  const [location, setLocation] = useState<Location>(getDefaultLocation());
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [mode, setMode] = useState<ShootMode>("landscape");
  const [units, setUnits] = useState<Units>("imperial");
  const [theme, setTheme] = useState<Theme>("daylight");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calculationOpen, setCalculationOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeWindow, setActiveWindow] = useState("Last light");
  const [savedPlaces, setSavedPlaces] = useState<Location[]>([]);
  const [toast, setToast] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const forecastRequest = useRef(0);

  const tomorrow = forecast?.days[1] ?? forecast?.days[0];
  const recommendation = useMemo(() => forecast ? recommendTomorrow(forecast, mode) : null, [forecast, mode]);
  const selectedWindow = recommendation?.windows.find((item) => item.label === activeWindow) ?? recommendation?.windows[1] ?? recommendation?.windows[0];
  const dayWinner = forecast?.days.slice(1).reduce<ForecastDay | null>((best, day) => {
    if (!best) return day;
    return (getSkyPotential(day, false) + getSkyPotential(day, true)) > (getSkyPotential(best, false) + getSkyPotential(best, true)) ? day : best;
  }, null);

  const applyForecast = useCallback((payload: ForecastPayload) => {
    setForecast(payload);
    setLocation(payload.location);
    if (payload.source === "live") writeCachedForecast(payload);
    try { localStorage.setItem("aurea.location", JSON.stringify(payload.location)); } catch { /* forecast remains available for this session */ }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const refresh = useCallback(async (nextLocation = location, isOffline = offline) => {
    const request = ++forecastRequest.current;
    if (forecast) setRefreshing(true);
    else setLoading(true);
    setLocationError("");
    try {
      const next = await loadForecast(nextLocation, isOffline);
      if (request === forecastRequest.current) applyForecast(next);
    } catch (error: unknown) {
      if (request === forecastRequest.current) {
        const message = error instanceof Error ? error.message : "Unexpected forecast error.";
        const savedReportMatchesLocation = forecast?.location.id === nextLocation.id;
        setLocationError(`${isOffline ? "Offline forecast unavailable." : "Live forecast unavailable."} ${message}${savedReportMatchesLocation ? " Showing the last successful report." : ""}`);
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [applyForecast, forecast, location, offline]);

  useEffect(() => {
    let initialLocation = getDefaultLocation();
    try {
      const settings = localStorage.getItem("aurea.settings");
      if (settings) {
        const parsed = JSON.parse(settings) as { mode?: ShootMode; units?: Units; theme?: Theme; offline?: boolean };
        if (parsed.mode && modes.some((item) => item.id === parsed.mode)) setMode(parsed.mode);
        if (parsed.units === "metric" || parsed.units === "imperial") setUnits(parsed.units);
        if (parsed.theme && ["daylight", "darkroom", "astro"].includes(parsed.theme)) setTheme(parsed.theme);
      }
      const preferredLocation = localStorage.getItem("aurea.location");
      if (preferredLocation) initialLocation = JSON.parse(preferredLocation) as Location;
      setLocation(initialLocation);
      const places = localStorage.getItem("aurea.saved-places");
      setSavedPlaces(places ? JSON.parse(places) as Location[] : []);
      const cached = readCachedForecast(initialLocation.id);
      if (cached) {
        setForecast(cached);
        setLocation(cached.location);
      }
    } catch {
      setToast("Some saved settings could not be restored.");
    } finally {
      setPreferencesReady(true);
    }
    void refresh(readCachedForecast(initialLocation.id)?.location ?? initialLocation, false);
  // Load the current saved report once on entry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "daylight" ? "light" : "dark";
    try { localStorage.setItem("aurea.settings", JSON.stringify({ mode, units, theme, offline })); } catch { /* optional preference */ }
  }, [mode, units, theme, offline, preferencesReady]);

  useEffect(() => {
    if (!searchOpen || query.trim().length < 2) { setSuggestions([]); setSearchError(""); setSearchLoading(false); return; }
    setSearchError("");
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void searchLocations(query).then((results) => {
        setSuggestions(results);
        setSearchLoading(false);
      }).catch((error: unknown) => {
        setSuggestions([]);
        setSearchError(error instanceof Error ? error.message : "Location search failed. Try again.");
        setSearchLoading(false);
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, searchOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key !== "/" || isTyping || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setSearchOpen(true);
      window.setTimeout(() => searchInput.current?.focus(), 0);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEscape(() => setSettingsOpen(false), settingsOpen);
  useEscape(() => setCalculationOpen(false), calculationOpen);
  useEscape(() => setMenuOpen(false), menuOpen);

  const selectLocation = (next: Location) => {
    setQuery("");
    setSearchOpen(false);
    setSuggestions([]);
    const cached = readCachedForecast(next.id);
    setForecast(cached);
    setLocation(next);
    setLocationError("");
    setLoading(!cached);
    setRefreshing(Boolean(cached));
    try { localStorage.setItem("aurea.location", JSON.stringify(next)); } catch { setToast("This browser could not save the location preference."); }
    void refresh(next, offline);
  };

  const toggleSaved = () => {
    const exists = savedPlaces.some((place) => place.id === location.id);
    const next = exists ? savedPlaces.filter((place) => place.id !== location.id) : [...savedPlaces, location];
    setSavedPlaces(next);
    try { localStorage.setItem("aurea.saved-places", JSON.stringify(next)); } catch { setToast("This browser could not save the location."); return; }
    setToast(exists ? `${location.name} removed from saved places.` : `${location.name} saved for later.`);
  };

  const requestCurrentLocation = async () => {
    setLocationError("");
    try {
      const current = await getCurrentLocation();
      selectLocation(current);
    } catch (error) {
      const permissionDenied = typeof error === "object" && error !== null && "code" in error && error.code === 1;
      setLocationError(permissionDenied
        ? "Location access is off. Allow it in your browser settings, or search for a place instead."
        : "Could not find your location. Search for a place instead.");
    }
  };

  const toggleOffline = () => {
    const next = !offline;
    setOffline(next);
    void refresh(location, next);
    setToast(next
      ? readCachedForecast(location.id) ? "Offline view on. Showing your last saved forecast." : "Offline view on. No saved forecast is available for this place."
      : "Back online. Checking for a fresh forecast…");
  };

  const goToWeek = () => {
    document.getElementById("week-ahead")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMenuOpen(false);
  };

  const openSearch = () => {
    setSearchOpen(true);
    window.setTimeout(() => searchInput.current?.focus(), 20);
  };

  const searchResults = searchOpen && query.trim().length >= 2;
  const dataDay = tomorrow;
  const cloudSnapshot = dataDay?.hours.find((hour) => Number(hour.time.slice(11, 13)) === 12) ?? null;
  const morningHumidity = dataDay?.hours.find((hour) => Number(hour.time.slice(11, 13)) === 9)?.humidity ?? null;

  return (
    <div className="app-shell" data-ui>
      <a className="skip-link" href="#main-content">Skip to forecast</a>
      <aside id="primary-navigation" className={`sidebar ${menuOpen ? "sidebar-open" : ""}`} role={menuOpen ? "dialog" : "complementary"} aria-modal={menuOpen || undefined} aria-label="Main navigation">
        <div className="brand-lockup">
          <Link className="brand-home" href="/" aria-label="Aurea home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-name" translate="no">Aurea</span>
          </Link>
          <button className="icon-button mobile-menu-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="side-location">
          <span className="side-location-label">Working location</span>
          <span className="side-location-name"><MapPin size={14} aria-hidden="true" />{location.name}</span>
          <span className="side-location-sub">{location.region}{location.country ? ` · ${location.country}` : ""}</span>
        </div>
        <nav className="side-nav" aria-label="Forecast views">
          <a className="nav-link nav-active" href="#tomorrow" onClick={() => setMenuOpen(false)}><Sun size={16} aria-hidden="true" />Tomorrow</a>
          <button className="nav-link" onClick={goToWeek}><Activity size={16} aria-hidden="true" />Week ahead</button>
          <button className="nav-link" onClick={openSearch}><Bookmark size={16} aria-hidden="true" />Saved places <span className="nav-count">{savedPlaces.length}</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="saved-mini-heading">Saved places</div>
          {savedPlaces.length ? savedPlaces.slice(0, 3).map((place) => (
            <button key={place.id} className={`saved-place ${place.id === location.id ? "saved-place-current" : ""}`} onClick={() => selectLocation(place)}>
              <span className="saved-place-dot" />{place.name}<ChevronRight size={14} aria-hidden="true" />
            </button>
          )) : (
            <p className="saved-empty">Your next location starts with the bookmark at the top.</p>
          )}
          <button className="settings-link" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}><Settings2 size={16} aria-hidden="true" />Settings</button>
          <div className="sidebar-footnote"><span className="status-dot" />Local time · {forecast?.timezone?.replaceAll("_", " ") ?? "…"}</div>
        </div>
      </aside>
      {menuOpen && <button aria-label="Close navigation" className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumb"><span>Forecast</span><ChevronRight size={14} aria-hidden="true" /><strong>{location.name}</strong></div>
          <div className="topbar-actions">
            {searchOpen ? (
              <div className="search-box search-box-open">
                <Search size={16} aria-hidden="true" />
                <input ref={searchInput} role="combobox" aria-label="Search for a location" aria-autocomplete="list" aria-expanded={searchResults && suggestions.length > 0} aria-controls="location-suggestions" name="location" autoComplete="off" placeholder="Search a city or place…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); if (event.key === "ArrowDown" && suggestions[0]) { event.preventDefault(); document.querySelector<HTMLElement>(".search-result")?.focus(); } if (event.key === "Enter" && suggestions[0]) selectLocation(suggestions[0]); }} />
                <button className="icon-button search-close" aria-label="Close location search" onClick={() => { setSearchOpen(false); setQuery(""); }}><X size={16} /></button>
                {searchResults && <div id="location-suggestions" className="search-results" role="listbox" aria-label="Location suggestions">
                  {suggestions.map((place, index) => <button key={place.id} role="option" aria-selected="false" className="search-result" onClick={() => selectLocation(place)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const options = Array.from(document.querySelectorAll<HTMLElement>(".search-result")); const next = event.key === "ArrowDown" ? index + 1 : index - 1; (options[next] ?? searchInput.current)?.focus(); } }}><MapPin size={15} aria-hidden="true" /><span><strong>{place.name}</strong><small>{place.region}, {place.country}</small></span></button>)}
                  {!suggestions.length && !searchError && <p className="search-message" aria-live="polite">{searchLoading ? "Looking for a place…" : "No places found. Try a nearby city name."}</p>}
                  {searchError && <p className="search-message search-error" role="status">{searchError}</p>}
                </div>}
              </div>
            ) : (
              <button className="topbar-search" onClick={openSearch}><Search size={16} aria-hidden="true" /><span>Find a place</span><kbd>/</kbd></button>
            )}
            <button className="icon-button locate-button" aria-label="Use current location" title="Use current location" onClick={() => void requestCurrentLocation()}><LocateFixed size={17} /></button>
            <button className={`offline-button ${offline ? "offline-on" : ""}`} onClick={toggleOffline} aria-pressed={offline}>
              {offline ? <WifiOff size={15} aria-hidden="true" /> : <Wifi size={15} aria-hidden="true" />}
              <span>{offline ? "Offline" : "Online"}</span>
            </button>
          </div>
        </header>

        <main id="main-content" className="main-content">
          <div className="page-heading" id="tomorrow">
            <div>
              <p className="page-context">{tomorrow ? dayLabel(tomorrow.date, forecast?.timezone ?? "UTC") : "Tomorrow’s forecast"} · {location.name}</p>
              <h1>Tomorrow, in light.</h1>
            </div>
            <div className="heading-actions">
              <button className={`save-button ${savedPlaces.some((place) => place.id === location.id) ? "is-saved" : ""}`} onClick={toggleSaved} aria-pressed={savedPlaces.some((place) => place.id === location.id)}>
                <Bookmark size={15} aria-hidden="true" />{savedPlaces.some((place) => place.id === location.id) ? "Saved" : "Save place"}
              </button>
              <button className="icon-button refresh-button" aria-label="Refresh forecast" title="Refresh forecast" onClick={() => void refresh()} disabled={refreshing || offline}><RefreshCw size={16} className={refreshing ? "spin" : ""} /></button>
            </div>
          </div>

          {(forecast?.source === "cached" || forecast?.source === "sample" || locationError) && (
            <div className={`data-notice ${locationError ? "notice-error" : ""}`} role="status" aria-live="polite">
              {locationError ? <Info size={15} aria-hidden="true" /> : forecast?.source === "cached" ? <WifiOff size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
              <span>{locationError || (forecast?.source === "cached" ? "Offline data · last saved forecast" : "Sample conditions · live forecast unavailable")}</span>
              {!offline && (locationError || forecast?.source !== "live") && <button onClick={() => void refresh()}>Retry</button>}
            </div>
          )}

          {loading && !forecast ? (
            <div className="loading-state" role="status" aria-live="polite">
              <div className="loading-orbit"><span /><span /><span /></div>
              <p>Reading tomorrow’s light…</p>
              <span>Checking the horizon, not just the clouds.</span>
            </div>
          ) : !forecast || !recommendation || !dataDay ? (
            <div className="empty-state"><Sun size={24} aria-hidden="true" /><h2>No light report yet</h2><p>Choose a place or check your connection to build tomorrow’s forecast.</p><button className="primary-button" onClick={() => void refresh()}>Try again</button></div>
          ) : (
            <>
              <section className="decision-row" aria-labelledby="verdict-heading">
                <div className={`verdict-panel ${recommendation.verdict === "GO" ? "verdict-go" : "verdict-skip"}`}>
                  <div className="verdict-topline"><span className="live-mark"><span />{forecast.source === "live" ? "Forecast ready" : forecast.source === "cached" ? "Saved forecast" : "Sample report"}</span><span className="verdict-mode">{modes.find((item) => item.id === mode)?.label} read</span></div>
                  <div className="verdict-core">
                    <div>
                      <h2 id="verdict-heading" className="verdict-word">{recommendation.verdict === "GO" ? "GO" : "SKIP"}<span className="verdict-period">.</span></h2>
                    </div>
                    <div className="score-lockup"><strong>{recommendation.score}</strong><span>ML WEATHER<br />SCORE</span></div>
                  </div>
                  <p className="verdict-summary">{recommendation.summary}</p>
                  <div className="verdict-footer">
                    <button className="calculation-link" onClick={() => setCalculationOpen(true)}><Info size={15} aria-hidden="true" />How we got here</button>
                    {selectedWindow?.start && <span className="best-window">Best window <b>{clockLabel(selectedWindow.start)}–{clockLabel(selectedWindow.end)}</b></span>}
                  </div>
                </div>

                <div className="mode-panel">
                  <div className="mode-heading"><div><h2>Shoot type</h2><p>The call changes with your kit.</p></div><Compass size={18} aria-hidden="true" /></div>
                  <div className="mode-switch" role="group" aria-label="Choose shoot type">
                    {modes.map((item) => <button key={item.id} onClick={() => setMode(item.id)} className={mode === item.id ? "mode-active" : ""} aria-pressed={mode === item.id}>{item.label}</button>)}
                  </div>
                  <div className="mode-advice"><span className="advice-mark" aria-hidden="true">↗</span><span>{selectedWindow?.reason ?? "Conditions are recalculated for this kind of shoot."}</span></div>
                </div>
              </section>

              <section className="light-windows" aria-label="Golden hour and blue hour">
                <div className="light-windows-grid">
                  <div className="light-window light-window-golden">
                    <div className="light-window-heading"><h2><Sun size={16} strokeWidth={1.8} aria-hidden="true" />Golden hour</h2><span>Morning</span></div>
                    <div className="light-window-details">
                      <time>{clockRange(dataDay.sunrise, dataDay.solar.goldenHourEnd)}</time>
                      <div className="light-window-facing">
                        <Navigation size={25} strokeWidth={1.6} aria-hidden="true" style={{ transform: `rotate(${compassAngle(dataDay.solar.goldenMorningAzimuth)}deg)` }} />
                        <span>Face <b>{compassDirectionName(dataDay.solar.goldenMorningAzimuth)}{typeof dataDay.solar.goldenMorningAzimuth === "number" && Number.isFinite(dataDay.solar.goldenMorningAzimuth) ? ` · ${Math.round(dataDay.solar.goldenMorningAzimuth)}°` : ""}</b></span>
                      </div>
                    </div>
                  </div>
                  <div className="light-window light-window-blue">
                    <div className="light-window-heading"><h2><Moon size={16} strokeWidth={1.8} aria-hidden="true" />Blue hour</h2><span>Evening</span></div>
                    <div className="light-window-details">
                      <time>{clockRange(dataDay.sunset, dataDay.solar.dusk)}</time>
                      <div className="light-window-facing">
                        <Navigation size={25} strokeWidth={1.6} aria-hidden="true" style={{ transform: `rotate(${compassAngle(dataDay.solar.blueEveningAzimuth)}deg)` }} />
                        <span>Face <b>{compassDirectionName(dataDay.solar.blueEveningAzimuth)}{typeof dataDay.solar.blueEveningAzimuth === "number" && Number.isFinite(dataDay.solar.blueEveningAzimuth) ? ` · ${Math.round(dataDay.solar.blueEveningAzimuth)}°` : ""}</b></span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="timeline-section" aria-labelledby="light-heading">
                <div className="section-heading timeline-heading">
                  <div><div className="section-title-line"><h2 id="light-heading">Daylight timeline</h2><span className="local-time"><span />Location time</span></div><p>The sun’s path and twilight, from sunrise to dusk.</p></div>
                  <span className="timeline-date">{dayLabel(dataDay.date, forecast.timezone, { weekday: "short", month: "short", day: "numeric" })}</span>
                </div>
                <div className="timeline-controls" role="group" aria-label="Highlight a shooting window">
                  <button className={activeWindow === "First light" ? "timeline-control active" : "timeline-control"} onClick={() => setActiveWindow("First light")}><Sunrise size={15} aria-hidden="true" />First light</button>
                  <button className={activeWindow === "Last light" ? "timeline-control active" : "timeline-control"} onClick={() => setActiveWindow("Last light")}><Sunset size={15} aria-hidden="true" />Last light</button>
                </div>
                <LightTimeline day={dataDay} timezone={forecast.timezone} activeWindow={activeWindow} onSelectWindow={setActiveWindow} />
              </section>

              <section className="conditions-section" aria-labelledby="conditions-heading">
                <div className="conditions-summary">
                  <h2 id="conditions-heading">What the sky may look like</h2>
                  <p>{shortWeatherDescription(dataDay.weatherCode)} tomorrow · Rain chance up to {dataDay.precipitationMax === null ? "—" : `${dataDay.precipitationMax}%`} · {temperature(dataDay.temperatureLow, units)}–{temperature(dataDay.temperatureHigh, units)} · Winds up to {speed(dataDay.windMax, units)}</p>
                </div>
                <div className="cloud-layers" aria-label="Cloud cover by height, around midday">
                  {[
                    { label: "Low clouds", detail: "Near horizon", value: cloudSnapshot?.cloudLow ?? null },
                    { label: "Mid-level clouds", detail: "Middle sky", value: cloudSnapshot?.cloudMid ?? null },
                    { label: "High clouds", detail: "High sky", value: cloudSnapshot?.cloudHigh ?? null },
                  ].map((layer) => (
                    <div className="cloud-layer-row" key={layer.label}>
                      <span><b>{layer.label}</b><small>{layer.detail} · {cloudAmountDescription(layer.value)}</small></span>
                      <div className="cloud-layer-meter" role="meter" aria-label={`${layer.label} cover`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={layer.value ?? 0}><i style={{ width: `${layer.value === null ? 0 : Math.max(0, Math.min(100, layer.value))}%` }} /></div>
                      <strong>{layer.value === null ? "—" : `${layer.value}%`}</strong>
                    </div>
                  ))}
                </div>
                <p className="conditions-note">Low clouds can hide the horizon; higher clouds can add color and texture.</p>
              </section>

              <section className="week-section" id="week-ahead" aria-labelledby="week-heading">
                <div className="section-heading section-heading-compact"><div><h2 id="week-heading">The week, at a glance</h2><p>One clear plan beats seven weather icons.</p></div><button className="text-action" onClick={() => setToast(`Best light: ${dayWinner ? dayLabel(dayWinner.date, forecast.timezone, { weekday: "long", month: "short", day: "numeric" }) : "Forecast loading"}.`)}>Read the week <ChevronRight size={15} aria-hidden="true" /></button></div>
                <div className="week-strip">
                  {forecast.days.slice(1, 7).map((day) => {
                    const morning = getSkyPotential(day, false);
                    const evening = getSkyPotential(day, true);
                    const total = Math.round((morning + evening) / 2);
                    const isBest = day.date === dayWinner?.date;
                    return <article className={`week-day ${isBest ? "week-best" : ""}`} key={day.date} aria-label={`${dayLabel(day.date, forecast.timezone, { weekday: "long", month: "long", day: "numeric" })}, light score ${total}${isBest ? ", best day this week" : ""}`}>
                      <span className="week-day-name">{dayLabel(day.date, forecast.timezone, { weekday: "short" })}</span>
                      <span className="week-condition">{shortWeatherDescription(day.weatherCode)}</span>
                      <span className="week-glyph" aria-hidden="true">{total > 60 ? <Sun size={18} /> : <Cloud size={18} />}</span>
                      <span className="week-temps"><b>{temperature(day.temperatureHigh, units)}</b><span>{temperature(day.temperatureLow, units)}</span></span>
                      <span className="week-score"><i style={{ width: `${total}%` }} /><b>{total}</b></span>
                      {isBest && <span className="best-day-label"><Check size={11} aria-hidden="true" />Best day</span>}
                    </article>;
                  })}
                </div>
              </section>

              <footer className="forecast-footer">
                <span><span className="footer-mark" />Aurea reads light, not just weather.</span>
                <span>{forecast.source === "live" ? `Updated ${new Intl.DateTimeFormat("en-US", { timeZone: forecast.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(forecast.generatedAt))} local` : forecast.source === "cached" ? "Saved for offline use" : "Sample forecast · illustrative"}</span>
              </footer>
            </>
          )}
        </main>
      </div>

      {settingsOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="dialog-panel settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="icon-button dialog-close" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18} /></button>
        <h2 id="settings-title">Settings</h2><p className="dialog-copy">Your preferences stay on this device.</p>
        <div className="setting-row"><div><strong>Units</strong><span>Temperature, distance and wind</span></div><div className="segmented-control" role="group" aria-label="Units"><button className={units === "imperial" ? "selected" : ""} onClick={() => setUnits("imperial")} aria-pressed={units === "imperial"}>Imperial</button><button className={units === "metric" ? "selected" : ""} onClick={() => setUnits("metric")} aria-pressed={units === "metric"}>Metric</button></div></div>
        <div className="setting-row"><div><strong>Default shoot type</strong><span>Used to make your go / skip call</span></div><label className="select-wrap"><span className="visually-hidden">Default shoot type</span><select value={mode} onChange={(event) => setMode(event.target.value as ShootMode)}>{modes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label></div>
        <div className="setting-row setting-theme-row"><div><strong>Theme</strong><span>Built for daylight or a dark field</span></div><div className="theme-options" role="group" aria-label="Theme"><button className={theme === "daylight" ? "theme-active" : ""} onClick={() => setTheme("daylight")} aria-pressed={theme === "daylight"}><Sun size={15} aria-hidden="true" />Daylight</button><button className={theme === "darkroom" ? "theme-active" : ""} onClick={() => setTheme("darkroom")} aria-pressed={theme === "darkroom"}><Moon size={15} aria-hidden="true" />Darkroom</button><button className={theme === "astro" ? "theme-active" : ""} onClick={() => setTheme("astro")} aria-pressed={theme === "astro"}><Compass size={15} aria-hidden="true" />Astro red</button></div></div>
        <div className="settings-note"><span className="settings-note-mark" />Astro red preserves night vision with a dim red accent and low-luminance surfaces.</div>
        <button className="primary-button settings-done" onClick={() => setSettingsOpen(false)}>Done <Check size={15} aria-hidden="true" /></button>
      </section></div>}

      {calculationOpen && recommendation && dataDay && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalculationOpen(false); }}><section className="dialog-panel calculation-dialog" role="dialog" aria-modal="true" aria-labelledby="calculation-title">
        <button className="icon-button dialog-close" aria-label="Close calculation" onClick={() => setCalculationOpen(false)}><X size={18} /></button>
        <h2 id="calculation-title">How Aurea calls it</h2><p className="dialog-copy">Aurea’s weather model scores the forecast hour by hour, then compares tomorrow’s sunrise and sunset windows for {mode}. A window at 58 or above earns a GO.</p>
        <div className="calculation-score"><strong>{recommendation.score}<small>/100</small></strong><span>{recommendation.verdict} for {mode}</span></div>
        <div className="calculation-factors"><div><span>Cloud cover</span><b>{dataDay.hours.find((hour) => Number(hour.time.slice(11, 13)) === 12)?.cloudCover ?? "—"}%</b></div><div><span>Rain chance</span><b>{dataDay.precipitationMax ?? "—"}% daily peak</b></div><div><span>Wind at the window</span><b>{speed(selectedWindow?.label === "First light" ? dataDay.hours[6]?.gusts ?? null : dataDay.hours[18]?.gusts ?? null, units)} gusts</b></div><div><span>Humidity</span><b>{morningHumidity === null ? "—" : `${morningHumidity}%`}</b></div></div>
        <p className="calculation-footnote">The model reads cloud cover, rainfall, wind and humidity. It is trained on weather-based scoring rules; user feedback is not part of the score.</p>
        <button className="primary-button settings-done" onClick={() => setCalculationOpen(false)}>Back to the forecast <ChevronRight size={15} aria-hidden="true" /></button>
      </section></div>}

      {toast && <div className="toast-message" role="status" aria-live="polite"><Check size={15} aria-hidden="true" />{toast}</div>}
      <nav className="mobile-bottom-nav" aria-label="Quick navigation"><a href="#tomorrow" className="bottom-nav-active"><Sun size={18} aria-hidden="true" /><span>Tomorrow</span></a><button onClick={goToWeek}><Activity size={18} aria-hidden="true" /><span>Week</span></button><button onClick={() => setSettingsOpen(true)}><Settings2 size={18} aria-hidden="true" /><span>Settings</span></button></nav>
    </div>
  );
}
