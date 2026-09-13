import React from 'react'
import { MapContainer, TileLayer, Circle, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * Drag-a-pin geofence picker.
 *
 * The mobile Geofence Zones screen has had a map picker since it shipped; the
 * website only ever offered two numeric inputs, so setting up a site meant
 * copying coordinates out of Google Maps and trusting you had not transposed a
 * digit. A wrong centre is invisible — the zone simply never matches, nobody
 * at that site can punch in, and nothing on screen explains why.
 *
 * Two-way bound with the latitude/longitude fields on purpose: typing still
 * works and moves the pin, and moving the pin rewrites the fields. Neither
 * input is the source of truth on its own.
 *
 * Tiles come from OpenStreetMap, which needs no API key. Attribution is
 * required by their licence — do not remove it.
 */

// Leaflet's default marker icon resolves its PNGs relative to the CSS file,
// which Vite's asset hashing breaks — the classic "markers are invisible"
// bug. Point it at the CDN copies explicitly.
const markerIcon = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
})

/** Click/drag anywhere on the map to move the centre. */
function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  })
  return null
}

/**
 * Recentres the viewport when the coordinates change from OUTSIDE the map
 * (someone typed, or hit "use my current location"). Deliberately does not
 * fire on a map click — panning the view out from under a drag is jarring.
 */
function Recenter({ lat, lng, trigger }: { lat: number; lng: number; trigger: number }) {
  const map = useMap()
  React.useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lng)) map.setView([lat, lng], map.getZoom())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

export interface LocationMapPickerProps {
  lat: number
  lng: number
  /** Drawn as a circle so the admin can see the area the radius actually covers. */
  radiusMeters: number
  onChange: (lat: number, lng: number) => void
  /** Bump to recentre the viewport (e.g. after "use my current location"). */
  recenterKey?: number
}

export function LocationMapPicker({ lat, lng, radiusMeters, onChange, recenterKey = 0 }: LocationMapPickerProps) {
  // Fall back to a sane centre rather than rendering a grey void at 0,0 in the
  // Atlantic while the admin is still typing. India Gate is as good as any and
  // matches where most tenants are.
  const hasFix = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
  const centre: [number, number] = hasFix ? [lat, lng] : [28.6129, 77.2295]
  const radius = Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 100

  return (
    <div className="overflow-hidden rounded-xl border border-border-default">
      <MapContainer
        center={centre}
        zoom={hasFix ? 16 : 5}
        scrollWheelZoom
        style={{ height: 260, width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPlace onPick={onChange} />
        <Recenter lat={centre[0]} lng={centre[1]} trigger={recenterKey} />
        {hasFix && (
          <>
            <Marker
              position={centre}
              icon={markerIcon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const p = (e.target as L.Marker).getLatLng()
                  onChange(p.lat, p.lng)
                },
              }}
            />
            <Circle center={centre} radius={radius} pathOptions={{ color: '#0F6E56', fillOpacity: 0.12 }} />
          </>
        )}
      </MapContainer>
      <p className="border-t border-border-default bg-bg-base px-3 py-1.5 text-xs text-text-tertiary">
        {hasFix
          ? 'Click the map or drag the pin to move the centre. The shaded circle is the punch-in area.'
          : 'Click the map to drop a pin, or use “Use my current location” below.'}
      </p>
    </div>
  )
}
