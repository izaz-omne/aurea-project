"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, Check, Sun, Sunrise, Sunset } from "lucide-react";
import riverBoats from "@/assets/wooden-boats-resemble-like-flowers-in-dhaka.jpg";
import oldBuriganga from "@/assets/boats-docked-along-buriganga-river-shoreline-in.jpg";
import rickshaws from "@/assets/rickshaw-parking-at-dhaka-9601873282.jpg";
import lalbaghFort from "@/assets/lalbagh-fort-lalbagh-dhaka-bangladesh.jpg";
import { getDefaultLocation, loadForecast } from "@/lib/api";
import { recommendTomorrow } from "@/lib/api/recommendation";
import type { ForecastPayload, Location, ShootMode } from "@/lib/api/types";

const shootModes: Array<{ id: ShootMode; label: string }> = [
  { id: "landscape", label: "Landscape" },
  { id: "portrait", label: "Portrait" },
  { id: "street", label: "Street" },
  { id: "astro", label: "Astro" },
  { id: "drone", label: "Drone" },
  { id: "wildlife", label: "Wildlife" },
];

function clock(value: string | null): string {
  if (!value) return "—";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function clockRange(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const startLabel = clock(start);
  const endLabel = clock(end);
  return startLabel.slice(-2) === endLabel.slice(-2)
    ? `${startLabel.replace(/ (AM|PM)$/, "")}–${endLabel}`
    : `${startLabel}–${endLabel}`;
}

function localDate(date: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(target));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date(target + target - represented));
}

function positionOf(value: string | null): number {
  if (!value) return 0;
  const [hour, minute] = value.split(":").map(Number);
  return ((hour * 60 + minute) / 1440) * 100;
}

function LightTrace({ forecast, activeWindow }: { forecast: ForecastPayload; activeWindow: string }) {
  const day = forecast.days[1] ?? forecast.days[0];
  const sunrise = positionOf(day.sunrise);
  const goldenEnd = positionOf(day.solar.goldenHourEnd);
  const sunset = positionOf(day.sunset);
  const noon = positionOf(day.solar.solarNoon);
  const morning = activeWindow === "Golden hour";
  const start = morning ? sunrise : sunset;
  const end = morning ? goldenEnd : positionOf(day.solar.dusk);
  const points = Array.from({ length: 25 }, (_, index) => {
    const hour = index;
    const progress = (hour * 60 - positionOf(day.sunrise) * 14.4) / ((positionOf(day.sunset) - positionOf(day.sunrise)) * 14.4 || 1);
    const light = progress < 0 || progress > 1 ? 0 : Math.sin(Math.PI * progress);
    const x = (hour / 24) * 100;
    const y = 79 - light * 57;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");

  return (
    <svg className="preview-trace" viewBox="0 0 100 88" preserveAspectRatio="none" role="img" aria-label={`Daylight curve for ${localDate(day.date, forecast.timezone)}`}>
      <path className="preview-gridline" d="M0 22H100M0 50H100M0 78H100" />
      <path className={`preview-band ${morning ? "" : "preview-band-blue"}`} d={`M${start} 8V80M${end} 8V80`} />
      <path className="preview-sunline" d={points} />
      <path className="preview-noon" d={`M${noon} 8V80`} />
      <circle className="preview-sun-dot" cx={noon} cy="22" r="2.3" />
      <path className="preview-axis" d="M0 80H100" />
    </svg>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [location, setLocation] = useState<Location>(getDefaultLocation());
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [forecastError, setForecastError] = useState("");
  const [mode, setMode] = useState<ShootMode>("landscape");
  const [activeWindow, setActiveWindow] = useState("Blue hour");
  const [loading, setLoading] = useState(true);
  const recommendation = useMemo(() => forecast ? recommendTomorrow(forecast, mode) : null, [forecast, mode]);
  const tomorrow = forecast?.days[1] ?? forecast?.days[0];
  const selectedWindow = recommendation?.windows[activeWindow === "Golden hour" ? 0 : 1] ?? recommendation?.windows[0];

  useEffect(() => {
    try {
      const preferredLocation = localStorage.getItem("aurea.location");
      if (preferredLocation) setLocation(JSON.parse(preferredLocation) as Location);
    } catch {
      // The default Dhaka location still works without saved preferences.
    }
  }, []);

  useEffect(() => {
    let current = true;
    setForecastError("");
    void loadForecast(location).then((report) => {
      if (current) setForecast(report);
    }).catch((error: unknown) => {
      if (current) setForecastError(error instanceof Error ? error.message : "Unable to load live weather.");
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [location]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const openForecast = () => {
    try {
      const current = JSON.parse(localStorage.getItem("aurea.settings") ?? "{}") as Record<string, unknown>;
      localStorage.setItem("aurea.settings", JSON.stringify({ ...current, mode }));
      localStorage.setItem("aurea.location", JSON.stringify(location));
    } catch {
      // The forecast still opens with its defaults when local storage is unavailable.
    }
    router.push("/forecast");
  };

  const dayName = tomorrow && forecast ? localDate(tomorrow.date, forecast.timezone) : "Tomorrow";
  const dataLabel = forecast?.source === "sample" ? "Sample light report" : forecast?.source === "cached" ? "Saved light report" : "Live Open-Meteo report";
  const selectedPeriod = tomorrow
    ? activeWindow === "Golden hour"
      ? { start: tomorrow.sunrise, end: tomorrow.solar.goldenHourEnd }
      : { start: tomorrow.sunset, end: tomorrow.solar.dusk }
    : { start: null, end: null };

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <Link className="landing-brand" href="/" aria-label="Aurea home">
          <span className="landing-mark" aria-hidden="true"><Sun size={15} strokeWidth={1.8} /></span>
          <span>Aurea</span>
        </Link>
        <nav className="landing-links" aria-label="Main navigation">
          <a href="#dhaka-light">Dhaka light</a>
          <a href="#field-notes">Field notes</a>
        </nav>
        <button className="landing-nav-action" onClick={openForecast}>Open forecast <ArrowRight size={15} aria-hidden="true" /></button>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="hero-copy">
            <h1 id="landing-title"><span>Light writes</span><span>Dhaka.</span></h1>
            <p className="hero-description">A live forecast for photographers, with tomorrow’s go / skip call and the best light windows in {location.name}.</p>
            <button className="hero-cta" onClick={openForecast}>See tomorrow’s light <ArrowRight size={17} aria-hidden="true" /></button>
            <div className="hero-aside"><span className="hero-aside-mark"><Sun size={14} aria-hidden="true" /></span><span>Machine learning uses clouds, rain, wind and humidity to score each shoot type.</span></div>
          </div>

          <figure className="hero-photograph">
            <Image src={riverBoats} alt="Wooden boats arranged like petals on dark water at Dhaka River Port" width={1920} height={1375} priority sizes="(max-width: 760px) 100vw, 58vw" />
            <figcaption className="hero-photo-caption"><span>Dhaka River Port</span><span>23°42′ N · 90°24′ E</span></figcaption>
            <div className="landing-instrument" data-ui aria-label="Interactive preview of tomorrow’s Dhaka light forecast">
              <div className="instrument-topline"><span className="instrument-brand"><span className="instrument-sun" /> AUREA / DHAKA</span><span className="instrument-source">{loading ? "Reading the sky…" : dataLabel}</span></div>
              {recommendation && tomorrow ? (
                <>
                  <div className="instrument-verdict-row"><div><span className="instrument-date">{dayName}</span><strong className="instrument-verdict">{recommendation.verdict}<span>.</span></strong></div><div className="instrument-score"><strong>{recommendation.score}</strong><span>ML WEATHER<br />SCORE</span></div></div>
                  <p className="instrument-summary">{activeWindow} is the frame to chase. {selectedWindow?.reason}</p>
                  <div className="instrument-window-switch" role="group" aria-label="Choose the light window">
                    <button onClick={() => setActiveWindow("Golden hour")} className={activeWindow === "Golden hour" ? "window-active" : ""} aria-pressed={activeWindow === "Golden hour"}><span><Sunrise size={14} aria-hidden="true" />Golden hour</span><b>{clockRange(tomorrow.sunrise, tomorrow.solar.goldenHourEnd)}</b></button>
                    <button onClick={() => setActiveWindow("Blue hour")} className={activeWindow === "Blue hour" ? "window-active" : ""} aria-pressed={activeWindow === "Blue hour"}><span><Sunset size={14} aria-hidden="true" />Blue hour</span><b>{clockRange(tomorrow.sunset, tomorrow.solar.dusk)}</b></button>
                  </div>
                  <div className="instrument-chart"><LightTrace forecast={forecast!} activeWindow={activeWindow} /><div className="instrument-axis"><span>12 AM</span><span>Sunrise</span><span>Solar noon</span><span>Sunset</span><span>12 AM</span></div></div>
                  <div className="instrument-modes" role="group" aria-label="Choose a photography mode">
                    {shootModes.map((shootMode) => <button key={shootMode.id} onClick={() => setMode(shootMode.id)} aria-pressed={mode === shootMode.id}>{shootMode.label}</button>)}
                  </div>
                </>
              ) : (
                <div className="instrument-loading" role="status" aria-live="polite"><span className="loading-sun"><Sun size={17} aria-hidden="true" /></span><strong>{loading ? "Reading tomorrow’s light…" : forecastError ? "Live weather is unavailable." : "Your report is ready to open."}</strong><span>{loading ? "Following the local sun, not the phone clock." : forecastError || "Open the forecast for current weather and local solar times."}</span></div>
              )}
              <div className="instrument-footer"><span><span className="instrument-live-dot" />{forecast?.timezone ?? "Asia/Dhaka"}</span><span>Golden hour / blue hour</span></div>
            </div>
          </figure>
          <a className="hero-scroll" href="#dhaka-light"><span>Explore Dhaka light</span><ArrowDownRight size={16} aria-hidden="true" /></a>
        </section>

        <section className="dhaka-section" id="dhaka-light" aria-labelledby="dhaka-title">
          <div className="dhaka-heading" data-reveal><h2 id="dhaka-title">Dhaka, in its own light.</h2><span>From the Buriganga to the lanes of Old Dhaka, a place changes what the sky can do.</span></div>
          <div className="dhaka-gallery">
            <figure className="dhaka-image dhaka-river" data-reveal>
              <Image src={oldBuriganga} alt="The Buriganga riverfront in Dhaka, photographed in 1952" width={1920} height={1138} sizes="(max-width: 700px) 100vw, 53vw" loading="lazy" />
              <figcaption><span>Buriganga, 1952</span><span>Riverfront, before the frame</span></figcaption>
            </figure>
            <figure className="dhaka-image dhaka-rickshaw" data-reveal>
              <Image src={rickshaws} alt="A row of colorful cycle rickshaws parked beneath trees in Dhaka" width={1920} height={1080} sizes="(max-width: 700px) 100vw, 43vw" loading="lazy" />
              <figcaption><span>Rickshaw stand</span><span>Dhaka, Bangladesh</span></figcaption>
            </figure>
          </div>
          <div className="fort-note" data-reveal><p>Old brick. A cloud-soft noon. Blue hour around the roofline.</p></div>
          <figure className="dhaka-image dhaka-fort" data-reveal>
            <Image src={lalbaghFort} alt="Lalbagh Fort’s red brick walls against a wide overcast Dhaka sky" width={1920} height={2556} sizes="(max-width: 700px) 100vw, 38vw" loading="lazy" />
            <figcaption><span>Lalbagh Fort</span><span>Old Dhaka</span></figcaption>
          </figure>
        </section>

        <section className="field-notes" id="field-notes" aria-labelledby="field-notes-title">
          <div className="field-note-copy" data-reveal><h2 id="field-notes-title">Go for a reason.</h2><p>Aurea tells you what tomorrow’s conditions mean for the shot you have in mind.</p><button onClick={openForecast}>Read tomorrow’s report <ArrowRight size={16} aria-hidden="true" /></button></div>
          <div className="field-note-example" data-ui data-reveal><span className="example-pip"><Check size={13} aria-hidden="true" /></span><div><span className="example-title">The call for Dhaka</span><strong>{recommendation?.verdict ?? "…"}<i>.</i></strong><p>{recommendation?.summary ?? "Cloud, wind and the sun’s arc are being weighed together."}</p><span className="example-time">{activeWindow}<b>{clockRange(selectedPeriod.start, selectedPeriod.end)}</b></span></div></div>
        </section>

        <section className="landing-end" aria-labelledby="end-title">
          <h2 id="end-title">Be there for the light.</h2><p>Tomorrow is already on its way.</p><button onClick={openForecast}>Open Aurea <ArrowRight size={18} aria-hidden="true" /></button>
          <span className="end-coordinate">Dhaka, Bangladesh · Asia/Dhaka</span>
        </section>
      </main>

      <footer className="landing-footer">
        <Link className="footer-wordmark" href="/"><span className="landing-mark" aria-hidden="true"><Sun size={15} strokeWidth={1.8} /></span>Aurea</Link>
        <span className="footer-line">Forecasts for people who wait for the light.</span>
        <Link className="footer-app-link" href="/forecast">Open forecast <ArrowRight size={14} aria-hidden="true" /></Link>
        <details className="image-credits"><summary>Image credits</summary><ul>
          <li><a href="https://commons.wikimedia.org/wiki/File:Wooden_boats_resemble_like_flowers_in_Dhaka_River_Port.jpg" target="_blank" rel="noreferrer">“Wooden boats resemble like flowers in Dhaka River Port” by Md shameem ul islam, CC0</a></li>
          <li><a href="https://commons.wikimedia.org/wiki/File:Boats_docked_along_Buriganga_River_shoreline_in_Dhaka,_Bangladesh.jpg" target="_blank" rel="noreferrer">“Boats docked along Buriganga River shoreline in Dhaka, Bangladesh” by Clarence Woodrow Sorensen, public domain</a></li>
          <li><a href="https://commons.wikimedia.org/wiki/File:Rickshaw_Parking_at_Dhaka_(9601873282).jpg" target="_blank" rel="noreferrer">“Rickshaw Parking at Dhaka” by Nasir Khan Saikat, CC BY-SA 2.0</a></li>
          <li><a href="https://commons.wikimedia.org/wiki/File:Lalbagh_Fort,_Lalbagh,_Dhaka,_Bangladesh.jpg" target="_blank" rel="noreferrer">“Lalbagh Fort, Lalbagh, Dhaka, Bangladesh” by Tanvir Rahat, CC BY-SA 4.0</a></li>
        </ul></details>
        <span className="footer-copyright">Open-Meteo weather · SunCalc solar times</span>
      </footer>
    </div>
  );
}
