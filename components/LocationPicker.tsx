"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { GeocodeResult } from "@/lib/geocode";

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

type LatLng = { lat: number; lng: number };
type SearchStatus = "idle" | "searching" | "results" | "empty" | "error";

export default function LocationPicker({
  defaultLat,
  defaultLng,
  defaultLocationName
}: {
  defaultLat: number;
  defaultLng: number;
  defaultLocationName: string;
}) {
  const [position, setPosition] = useState<LatLng>({ lat: defaultLat, lng: defaultLng });
  const [locationName, setLocationName] = useState(defaultLocationName);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearchStatus("idle");
      return;
    }

    const controller = new AbortController();
    setSearchStatus("searching");
    const handle = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Geocode search failed");
        const data = (await response.json()) as { results?: GeocodeResult[] };
        const nextResults = data.results ?? [];
        setResults(nextResults);
        setSearchStatus(nextResults.length > 0 ? "results" : "empty");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setSearchStatus("error");
      }
    }, 400);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [query]);

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const response = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lng}`);
      if (!response.ok) return;
      const data = (await response.json()) as { label?: string | null };
      if (data.label) setLocationName(data.label);
    } catch {
      // Preserve the editable name when reverse geocoding is unavailable.
    }
  }

  function selectResult(result: GeocodeResult) {
    setPosition({ lat: result.lat, lng: result.lng });
    setLocationName(result.label);
    setResults([]);
    setQuery("");
    setSearchStatus("idle");
  }

  function movePin(lat: number, lng: number) {
    setPosition({ lat, lng });
    void reverseGeocode(lat, lng);
  }

  return (
    <div className="md:col-span-2">
      <input type="hidden" name="latitude" value={position.lat} readOnly />
      <input type="hidden" name="longitude" value={position.lng} readOnly />

      <label className="block">
        <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Search location</span>
        <input
          className="field-input"
          placeholder="Search venue or address…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {results.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-auto border border-line bg-card">
          {results.map((result) => (
            <li key={`${result.lat},${result.lng},${result.label}`}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-ink-soft hover:bg-paper/70"
                onClick={() => selectResult(result)}
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {searchStatus === "searching" ? (
        <p className="mt-1 text-xs text-ink-soft" role="status">
          Searching locations…
        </p>
      ) : null}
      {searchStatus === "empty" ? (
        <p className="mt-1 text-xs text-ink-soft" role="status">
          No matching locations found.
        </p>
      ) : null}
      {searchStatus === "error" ? (
        <p className="mt-1 text-xs text-signal" role="alert">
          Search unavailable — drag the pin or type the location name.
        </p>
      ) : null}

      <div className="mt-3 h-64 overflow-hidden border border-line">
        <MapContainer center={[position.lat, position.lng]} zoom={12} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <DraggableMarker position={position} onMove={movePin} />
          <ClickToMove onMove={movePin} />
          <Recenter position={position} />
        </MapContainer>
      </div>

      <label className="mt-3 block">
        <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Location name</span>
        <input
          className="field-input"
          name="locationName"
          value={locationName}
          onChange={(event) => setLocationName(event.target.value)}
        />
      </label>
      <p className="mt-1 font-mono text-[0.62rem] text-ink-soft">
        {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
      </p>
    </div>
  );
}

function DraggableMarker({
  position,
  onMove
}: {
  position: LatLng;
  onMove: (lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  return (
    <Marker
      draggable
      icon={markerIcon}
      position={[position.lat, position.lng]}
      ref={markerRef}
      eventHandlers={{
        dragend: () => {
          const marker = markerRef.current;
          if (marker) {
            const { lat, lng } = marker.getLatLng();
            onMove(lat, lng);
          }
        }
      }}
    />
  );
}

function ClickToMove({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => onMove(event.latlng.lat, event.latlng.lng)
  });
  return null;
}

function Recenter({ position }: { position: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.setView([position.lat, position.lng]);
  }, [map, position.lat, position.lng]);
  return null;
}
