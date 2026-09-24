// Ported from the design component GeofenceMap.dc.html (Leaflet, Esri street tiles).
import { createRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DCLogic, dc } from './dc-runtime'
import { GeofenceMapView } from './GeofenceMap.view'

export class GeofenceMap extends DCLogic {
  state: any = { ready: false, failed: false }
  mapRef = createRef<HTMLDivElement>()
  map: L.Map | null = null
  circle: L.Circle | null = null
  pin: L.CircleMarker | null = null
  _key = ''
  _t: ReturnType<typeof setTimeout> | undefined
  componentDidMount() {
    try { this.init() } catch { this.setState({ failed: true }) }
  }
  componentWillUnmount() {
    clearTimeout(this._t)
    if (this.map) this.map.remove()
  }
  vals() {
    const p = this.props
    return { lat: Number(p.lat), lng: Number(p.lng), r: Math.max(10, Number(p.radius) || 100) }
  }
  init() {
    if (!this.mapRef.current) return
    const v = this.vals(), lat = isFinite(v.lat) && this.props.lat !== '' ? v.lat : 17.3601, lng = isFinite(v.lng) && this.props.lng !== '' ? v.lng : 78.5368
    this.map = L.map(this.mapRef.current, { zoomControl: true, scrollWheelZoom: false }).setView([lat, lng], 16)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }).addTo(this.map)
    this.circle = L.circle([lat, lng], { radius: v.r, color: '#0f6e56', weight: 2, dashArray: '6 5', fillColor: '#10b981', fillOpacity: 0.18 }).addTo(this.map)
    this.pin = L.circleMarker([lat, lng], { radius: 9, color: '#ffffff', weight: 3, fillColor: '#0f6e56', fillOpacity: 1 }).addTo(this.map)
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.props.readOnly || !this.props.onPick) return
      this.props.onPick(+e.latlng.lat.toFixed(7), +e.latlng.lng.toFixed(7))
    })
    this._key = lat + ',' + lng
    this.setState({ ready: true })
    this._t = setTimeout(() => this.map && this.map.invalidateSize(), 250)
  }
  componentDidUpdate() {
    if (!this.map || !this.pin || !this.circle) return
    const v = this.vals()
    if (!isFinite(v.lat) || !isFinite(v.lng) || this.props.lat === '' || this.props.lng === '') return
    const ll: L.LatLngTuple = [v.lat, v.lng]
    this.pin.setLatLng(ll)
    this.circle.setLatLng(ll)
    this.circle.setRadius(v.r)
    const key = v.lat + ',' + v.lng
    if (this._key !== key) {
      this._key = key
      if (!this.map.getBounds().pad(-0.1).contains(ll)) this.map.setView(ll, this.map.getZoom())
    }
  }
  renderVals() {
    const ro = !!this.props.readOnly
    return {
      mapRef: this.mapRef, loading: !this.state.ready && !this.state.failed, failed: this.state.failed, readOnly: ro, editable: !ro && this.state.ready,
      radiusLabel: Math.max(10, Number(this.props.radius) || 100) + ' m radius', sk: { style: { width: '100%', height: '100%', borderRadius: 10 } },
    }
  }
  render() { return dc(this, GeofenceMapView, 'GeofenceMap') }
}
