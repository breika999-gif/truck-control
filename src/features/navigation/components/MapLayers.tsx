import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';
import { RouteResult } from '../api/directions';
import { TruckPOI } from '../api/poi';
import { RouteOption, POICard } from '../../../shared/services/backendApi';

interface MapLayersProps {
  mapIsLoaded: boolean;
  mapMode: string;
  showTraffic: boolean;
  showIncidents: boolean;
  showRestrictions: boolean;
  showStarredLayer: boolean;
  navigating: boolean;
  trafficKey: number;
  lightMode: boolean;
  route: RouteResult | null;
  routeShape: GeoJSON.FeatureCollection | GeoJSON.Geometry | null;
  routeLineColor: string;
  exitsGeoJSON: GeoJSON.FeatureCollection;
  navTrafficAlerts: GeoJSON.FeatureCollection | null;
  starGeoJSON: GeoJSON.FeatureCollection;
  starredPOIs: TruckPOI[];
  customOriginRef: React.MutableRefObject<[number, number] | null>;
  userCoords: [number, number] | null;
  destination: [number, number] | null;
  parkingResults: POICard[];
  parkingGeoJSON: GeoJSON.FeatureCollection;
  fuelResults: POICard[];
  fuelGeoJSON: GeoJSON.FeatureCollection;
  businessResults: TruckPOI[];
  businessGeoJSON: GeoJSON.FeatureCollection;
  cameraResults: TruckPOI[];
  cameraGeoJSON: GeoJSON.FeatureCollection;
  overtakingResults: any[]; 
  overtakingGeoJSON: GeoJSON.FeatureCollection;
  routeOptions: RouteOption[];
  selectedRouteIdx: number | null;
  navigateTo: (coords: [number, number], name: string) => void;
  setSelectedParking: (p: POICard) => void;
  handleSelectRouteOption: (idx: number) => void;
  ttsSpeak: (text: string) => void;
  voiceMutedRef: React.MutableRefObject<boolean>;
}

const NEON = '#00f7ff';

const MapLayers: React.FC<MapLayersProps> = ({
  mapIsLoaded,
  mapMode,
  showTraffic,
  showIncidents,
  showRestrictions,
  showStarredLayer,
  navigating,
  trafficKey,
  lightMode,
  route,
  routeShape,
  routeLineColor,
  exitsGeoJSON,
  navTrafficAlerts,
  starGeoJSON,
  starredPOIs,
  customOriginRef,
  userCoords,
  destination,
  parkingResults,
  parkingGeoJSON,
  fuelResults,
  fuelGeoJSON,
  businessResults,
  businessGeoJSON,
  cameraResults,
  cameraGeoJSON,
  overtakingResults,
  overtakingGeoJSON,
  routeOptions,
  selectedRouteIdx,
  navigateTo,
  setSelectedParking,
  handleSelectRouteOption,
  ttsSpeak,
  voiceMutedRef,
}) => {
  return (
    <>
      {/* ── Real-time traffic overlay ── */}
      {mapIsLoaded && showTraffic && mapMode !== 'satellite' && (
        <Mapbox.VectorSource
          key={`traffic-${trafficKey}`}
          id="traffic-v1"
          url="mapbox://mapbox.mapbox-traffic-v1"
        >
          <Mapbox.LineLayer
            id="traffic-low"
            sourceLayerID="traffic"
            slot="top"
            filter={['==', ['get', 'congestion'], 'low']}
            style={{ lineColor: '#2ecc71', lineWidth: 3, lineOpacity: 1.0, lineCap: 'round', lineJoin: 'round' }}
          />
          <Mapbox.LineLayer
            id="traffic-moderate"
            sourceLayerID="traffic"
            slot="top"
            filter={['==', ['get', 'congestion'], 'moderate']}
            style={{ lineColor: '#f39c12', lineWidth: 4, lineOpacity: 1.0, lineCap: 'round', lineJoin: 'round' }}
          />
          <Mapbox.LineLayer
            id="traffic-heavy"
            sourceLayerID="traffic"
            slot="top"
            filter={['==', ['get', 'congestion'], 'heavy']}
            style={{ lineColor: '#8B0000', lineWidth: 7, lineOpacity: 1.0, lineCap: 'round', lineJoin: 'round' }}
          />
          <Mapbox.LineLayer
            id="traffic-closed-bg"
            sourceLayerID="traffic"
            slot="top"
            filter={['any', ['==', ['get', 'congestion'], 'closed'], ['==', ['get', 'congestion'], 'severe']]}
            style={{ lineColor: '#cc0000', lineWidth: 9, lineOpacity: 1.0, lineCap: 'butt', lineJoin: 'miter' }}
          />
          <Mapbox.LineLayer
            id="traffic-closed-stripe"
            sourceLayerID="traffic"
            slot="top"
            filter={['any', ['==', ['get', 'congestion'], 'closed'], ['==', ['get', 'congestion'], 'severe']]}
            style={{
              lineColor: '#ffffff',
              lineWidth: 9,
              lineOpacity: 1.0,
              lineCap: 'butt',
              lineJoin: 'miter',
              lineDasharray: [1.5, 1.5],
            }}
          />
          <Mapbox.SymbolLayer
            id="traffic-sign-closed"
            sourceLayerID="traffic"
            filter={['any', ['==', ['get', 'congestion'], 'closed'], ['==', ['get', 'congestion'], 'severe']]}
            minZoomLevel={6}
            style={{
              symbolPlacement: 'line-center',
              iconImage: 'sign-closed',
              iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.08, 11, 0.12, 14, 0.16, 17, 0.18],
              iconPitchAlignment: 'viewport',
              iconRotationAlignment: 'viewport',
              iconAnchor: 'bottom',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
          />
        </Mapbox.VectorSource>
      )}

      {/* ── Incidents overlay ── */}
      {mapIsLoaded && showIncidents && mapMode !== 'satellite' && (
        <Mapbox.VectorSource id="incidents-v1" url="mapbox://mapbox.mapbox-traffic-v1">
          <Mapbox.SymbolLayer
            id="incident-signs-point"
            sourceLayerID="incidents"
            filter={['==', ['geometry-type'], 'Point']}
            minZoomLevel={7}
            style={{
              iconImage: ['match', ['get', 'class'], 'road_closure', 'sign-closed', 'lane_restriction', 'sign-closed', 'sign-danger-0'],
              iconSize: ['interpolate', ['linear'], ['zoom'], 7, 0.10, 10, 0.14, 13, 0.18, 16, 0.22],
              iconPitchAlignment: 'viewport',
              iconRotationAlignment: 'viewport',
              iconAnchor: 'bottom',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
          />
          <Mapbox.SymbolLayer
            id="incident-signs-line"
            sourceLayerID="incidents"
            filter={['==', ['geometry-type'], 'LineString']}
            minZoomLevel={7}
            style={{
              symbolPlacement: 'line-center',
              iconImage: ['match', ['get', 'class'], 'road_closure', 'sign-closed', 'lane_restriction', 'sign-closed', 'sign-danger-0'],
              iconSize: ['interpolate', ['linear'], ['zoom'], 7, 0.10, 10, 0.14, 13, 0.18, 16, 0.22],
              iconPitchAlignment: 'viewport',
              iconRotationAlignment: 'viewport',
              iconAnchor: 'bottom',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
          />
          <Mapbox.LineLayer
            id="incident-lines"
            sourceLayerID="incidents"
            filter={['==', ['geometry-type'], 'LineString']}
            style={{ lineColor: '#e74c3c', lineWidth: 6, lineOpacity: 1.0, lineCap: 'butt', lineDasharray: [2, 2] }}
          />
        </Mapbox.VectorSource>
      )}

      {/* ── Truck restrictions ── */}
      {mapIsLoaded && mapMode !== 'satellite' && (showRestrictions || navigating) && (
        <Mapbox.VectorSource id="streets-v8" url="mapbox://mapbox.mapbox-streets-v8">
          <Mapbox.LineLayer
            id="truck-bridge-warning"
            sourceLayerID="road"
            filter={['==', ['get', 'structure'], 'bridge']}
            minZoomLevel={10}
            style={{ lineColor: lightMode ? '#0077aa' : '#00bbee', lineWidth: 5, lineOpacity: lightMode ? 0.38 : 0.32, lineCap: 'round' }}
          />
          <Mapbox.LineLayer
            id="truck-tunnel-warning"
            sourceLayerID="road"
            filter={['==', ['get', 'structure'], 'tunnel']}
            minZoomLevel={10}
            style={{ lineColor: lightMode ? '#e07000' : '#ffaa33', lineWidth: 6, lineOpacity: lightMode ? 0.62 : 0.52, lineDasharray: [2, 2], lineCap: 'round' }}
          />
        </Mapbox.VectorSource>
      )}

      {/* ── Route ── */}
      {mapIsLoaded && routeShape && (
        <Mapbox.ShapeSource id="route-source" shape={routeShape}>
          <Mapbox.LineLayer id="route-casing" slot="middle" style={{ lineColor: '#0a0a1a', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
          <Mapbox.LineLayer
            id="route-line"
            slot="middle"
            style={{
              lineColor: ['match', ['get', 'congestion'], 'low', routeLineColor, 'moderate', '#FF9500', 'heavy', '#FF3B30', 'severe', '#8B0000', routeLineColor],
              lineWidth: 5, lineCap: 'round', lineJoin: 'round',
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* ── Route Arrows ── */}
      {mapIsLoaded && route && (
        <Mapbox.ShapeSource id="route-arrows-source" shape={{ type: 'Feature', properties: {}, geometry: route.geometry }}>
          <Mapbox.SymbolLayer
            id="route-direction-arrows"
            slot="middle"
            style={{
              symbolPlacement: 'line', symbolSpacing: 90, textField: '›', textSize: 20,
              textColor: 'rgba(255,255,255,0.90)', textHaloColor: 'rgba(0,0,0,0.25)', textHaloWidth: 1,
              textRotationAlignment: 'map', textAllowOverlap: true, iconAllowOverlap: true,
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* ── Pins & Labels ── */}
      {mapIsLoaded && navigating && exitsGeoJSON.features.length > 0 && (
        <Mapbox.ShapeSource id="exits-source" shape={exitsGeoJSON}>
          <Mapbox.SymbolLayer
            id="exits-badge" slot="top" minZoomLevel={9}
            style={{ textField: ['get', 'label'], textSize: 13, textColor: '#000000', textHaloColor: '#f5c518', textHaloWidth: 4, textAnchor: 'center' }}
          />
        </Mapbox.ShapeSource>
      )}

      {mapIsLoaded && navigating && navTrafficAlerts && (
        <Mapbox.ShapeSource id="nav-alert-src" shape={navTrafficAlerts}>
          <Mapbox.SymbolLayer
            id="nav-alert-layer" slot="top" minZoomLevel={9}
            style={{
              textField: ['get', 'label'],
              textSize: 12,
              textColor: '#ffffff',
              textHaloWidth: 2,
              textAllowOverlap: false,
              textHaloColor: ['match', ['get', 'severity'],
                'severe',   '#8B0000',
                'heavy',    '#cc0000',
                '#E07800',
              ],
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Origin/Dest Pins */}
      {(route || navigating) && (
        <Mapbox.ShapeSource
          id="origin-pin-src"
          shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: customOriginRef.current ?? userCoords ?? [0, 0] }, properties: {} }}
        >
          <Mapbox.SymbolLayer id="origin-pin-layer" slot="top" style={{ textField: '🟢', textSize: 16, textAnchor: 'center', textAllowOverlap: true }} />
        </Mapbox.ShapeSource>
      )}

      {destination && (
        <Mapbox.ShapeSource id="dest-pin-src" shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: destination }, properties: {} }}>
          <Mapbox.SymbolLayer id="dest-pin-layer" slot="top" style={{ textField: '📍', textSize: 30, textAnchor: 'bottom', textAllowOverlap: true }} />
        </Mapbox.ShapeSource>
      )}

      {/* POI Pins (Parking, Fuel, Biz, Camera, etc.) */}
      {mapIsLoaded && parkingResults.length > 0 && (
        <Mapbox.ShapeSource
          id="parking-source"
          shape={parkingGeoJSON}
          onPress={(e) => {
            const feat = e.features[0];
            if (!feat) return;
            const idx = feat.properties?.index;
            const p = parkingResults[idx];
            if (p) {
              setSelectedParking(p);
              if (p.voice_desc && !voiceMutedRef.current) ttsSpeak(p.voice_desc);
            }
          }}
        >
          <Mapbox.SymbolLayer
            id="parking-symbols" slot="top" minZoomLevel={7}
            style={{
              iconImage: 'parking-icon',
              iconSize: ['interpolate', ['linear'], ['zoom'], 7, 0.4, 10, 0.6, 12, 0.8],
              iconAllowOverlap: true
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Fuel station pins */}
      {mapIsLoaded && fuelResults.length > 0 && (
        <Mapbox.ShapeSource id="fuel-source" shape={fuelGeoJSON}>
          <Mapbox.SymbolLayer
            id="fuel-symbols"
            style={{
              iconImage: 'fuel-icon',
              iconSize: 0.8,
              iconAllowOverlap: true
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Business pins */}
      {mapIsLoaded && businessResults.length > 0 && (
        <Mapbox.ShapeSource id="biz-source" shape={businessGeoJSON}>
          <Mapbox.SymbolLayer
            id="biz-symbols"
            style={{
              iconImage: 'biz-icon',
              iconSize: 0.8,
              iconAllowOverlap: true
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Camera pins */}
      {mapIsLoaded && cameraResults.length > 0 && (
        <Mapbox.ShapeSource id="camera-source" shape={cameraGeoJSON}>
          <Mapbox.SymbolLayer
            id="camera-emoji" slot="top" minZoomLevel={7}
            style={{
              iconImage: 'camera-icon',
              iconSize: ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 1.0],
              iconAnchor: 'bottom',
              iconOffset: [0, 0.5],
              iconAllowOverlap: true
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Overtaking restrictions */}
      {mapIsLoaded && overtakingResults.length > 0 && (
        <Mapbox.ShapeSource id="overtaking-src" shape={overtakingGeoJSON}>
          <Mapbox.SymbolLayer
            id="overtaking-sign" slot="top" minZoomLevel={7}
            style={{
              iconImage: 'no-overtaking',
              iconSize: ['interpolate', ['linear'], ['zoom'], 7, 0.6, 12, 1.2],
              iconAnchor: 'bottom',
              iconAllowOverlap: true
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Route alternatives */}
      {mapIsLoaded && routeOptions.map((opt, i) => {
        const isSelected = selectedRouteIdx === i;
        if (isSelected && route) return null;
        const coords = opt.geometry.coordinates;
        const midCoord = coords[Math.floor(coords.length / 2)] as [number, number];
        
        return (
          <React.Fragment key={`route-opt-${i}`}>
            <Mapbox.ShapeSource id={`route-opt-src-${i}`} shape={(opt.congestion_geojson as unknown as GeoJSON.FeatureCollection) || { type: 'Feature', properties: {}, geometry: opt.geometry }} onPress={() => handleSelectRouteOption(i)}>
              <Mapbox.LineLayer
                id={`route-opt-line-${i}`} slot={isSelected ? 'middle' : 'bottom'}
                style={{ 
                  lineColor: opt.congestion_geojson ? ['match', ['get', 'congestion'], 'low', NEON, 'moderate', '#ffcc00', 'heavy', '#ff4444', 'severe', '#8b0000', NEON] : opt.color,
                  lineWidth: isSelected ? 6 : 4, lineOpacity: isSelected ? 0.92 : 0.45, lineCap: 'round', lineJoin: 'round' 
                }}
              />
            </Mapbox.ShapeSource>
            <Mapbox.ShapeSource id={`route-opt-label-src-${i}`} shape={{ type: 'Feature', properties: { label: i === 0 ? 'Най-бърз' : 'Алтернатива' }, geometry: { type: 'Point', coordinates: midCoord } }}>
              <Mapbox.SymbolLayer
                id={`route-opt-label-${i}`} slot="top"
                style={{ textField: ['get', 'label'], textSize: 12, textColor: '#ffffff', textHaloColor: opt.color, textHaloWidth: 2, textAllowOverlap: false }}
              />
            </Mapbox.ShapeSource>
          </React.Fragment>
        );
      })}
    </>
  );
};

export default memo(MapLayers);
