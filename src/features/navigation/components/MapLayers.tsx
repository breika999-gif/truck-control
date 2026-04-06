import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';
import type * as GeoJSON from 'geojson';
import { RouteResult } from '../api/directions';
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
  routeShape: GeoJSON.FeatureCollection | GeoJSON.Geometry | GeoJSON.Feature | null;
  routeLineColor: string;
  exitsGeoJSON: GeoJSON.FeatureCollection;
  navTrafficAlerts: GeoJSON.FeatureCollection | null;
  starGeoJSON: GeoJSON.FeatureCollection;
  starredPOIs: any[];
  customOriginRef: React.MutableRefObject<[number, number] | null>;
  userCoords: [number, number] | null;
  destination: [number, number] | null;
  parkingResults: POICard[];
  fuelResults: POICard[];
  businessResults: any[];
  businessGeoJSON: GeoJSON.FeatureCollection;
  cameraResults: any[];
  cameraGeoJSON: GeoJSON.FeatureCollection;
  overtakingResults: any[]; 
  overtakingGeoJSON: GeoJSON.FeatureCollection;
  navCongestionVisible: GeoJSON.FeatureCollection | null;
  routeOptions: RouteOption[];
  selectedRouteIdx: number | null;
  navigateTo: (coords: [number, number], name: string) => void;
  setSelectedParking: (p: POICard) => void;
  setSelectedFuel: (f: POICard) => void;
  handleSelectRouteOption: (idx: number) => void;
  ttsSpeak: (text: string) => void;
  voiceMutedRef: React.MutableRefObject<boolean>;
  restrictionPoints?: Array<{ lng: number; lat: number; type: 'maxheight'|'maxweight'|'maxwidth'; value: string }>;
  currentStep?: number;
  drivingSeconds?: number;
  hosLimitS?: number;
}

const NEON = '#13BDFF';
const SAFE_GREEN = '#4CAF50';
const WARN_YELLOW = '#FFC107';
const DANGER_RED = '#F44336';

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
  fuelResults,
  businessResults,
  businessGeoJSON,
  cameraResults,
  cameraGeoJSON,
  overtakingResults,
  overtakingGeoJSON,
  navCongestionVisible,
  routeOptions,
  selectedRouteIdx,
  navigateTo,
  setSelectedParking,
  setSelectedFuel,
  handleSelectRouteOption,
  ttsSpeak,
  voiceMutedRef,
  restrictionPoints = [],
  currentStep = 0,
  drivingSeconds = 0,
  hosLimitS = 16200,
}) => {
  const turnArrowsGeoJSON = React.useMemo<GeoJSON.FeatureCollection>(() => {
    if (!route || !navigating) return { type: 'FeatureCollection', features: [] };
    const isTurnManeuver = (t: string) =>
      /turn|ramp|fork|merge|roundabout|rotary|keep|bear|sharp|u.turn/i.test(t);
    const maneuverIconKey = (type: string, modifier?: string): string => {
      const t = (type ?? '').toUpperCase();
      const m = (modifier ?? '').toLowerCase();
      if (/U.TURN|UTURN/.test(t) || m === 'uturn')               return '↩';
      if (/ROUNDABOUT|ROTARY/.test(t))                            return '↻';
      if (/(SHARP_LEFT|TURN_SHARP_LEFT)/.test(t) || m === 'sharp left')    return '↰';
      if (/(SHARP_RIGHT|TURN_SHARP_RIGHT)/.test(t) || m === 'sharp right') return '↱';
      if (/(KEEP_LEFT|BEAR_LEFT|SLIGHT.LEFT)/.test(t) || m === 'slight left')    return '↖';
      if (/(KEEP_RIGHT|BEAR_RIGHT|SLIGHT.RIGHT)/.test(t) || m === 'slight right') return '↗';
      if (/(TURN_LEFT)/.test(t) || m === 'left')                  return '←';
      if (/(TURN_RIGHT)/.test(t) || m === 'right')                return '→';
      if (/left/.test(m))  return '←';
      if (/right/.test(m)) return '→';
      return '↑';
    };
    const features: GeoJSON.Feature[] = [];
    const coords = route.geometry.coordinates;

    route.steps.slice(currentStep).forEach((step: any, i: number) => {
      const loc = step.intersections?.[0]?.location;
      const mType = step.maneuver?.type ?? '';
      if (!loc || !isTurnManeuver(mType)) return;

      const iconKey = maneuverIconKey(mType, step.maneuver?.modifier);

      // Use bearing_before — incoming direction aligns the arrow icon with the approach road
      const rotation = step.maneuver?.bearing_before ?? 0;

      features.push({ 
        type: 'Feature', 
        id: `arrow-${i}`, 
        geometry: { type: 'Point', coordinates: loc }, 
        properties: { iconKey, rotation } 
      });
    });
    return { type: 'FeatureCollection', features };
  }, [route, navigating, currentStep]);

  const restrictionGeoJSON = React.useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: restrictionPoints.map((rp, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [rp.lng, rp.lat] },
      properties: { value: rp.value, type: rp.type },
    })),
  }), [restrictionPoints]);

  const fuelGeoJSON_withIdx = React.useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: fuelResults.filter(f => f.lat && f.lng).map((f, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      properties: { index: i, name: f.name, distance_m: f.distance_m },
    })),
  }), [fuelResults]);

  const parkingGeoJSON_withIdx = React.useMemo<GeoJSON.FeatureCollection>(() => {
    const remainingS = hosLimitS - drivingSeconds;
    
    return {
      type: 'FeatureCollection',
      features: parkingResults.filter(p => p.lat && p.lng).map((p, i) => {
        let tachoStatus = 'safe';
        if (p.travel_time) {
          const bufferS = 900; // 15 min buffer
          if (p.travel_time > remainingS) {
            tachoStatus = 'danger';
          } else if (p.travel_time > (remainingS - bufferS)) {
            tachoStatus = 'warning';
          }
        }

        return {
          type: 'Feature',
          id: i,
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { 
            index: i, 
            name: p.name, 
            distance_m: p.distance_m,
            tachoStatus 
          },
        };
      }),
    };
  }, [parkingResults, drivingSeconds, hosLimitS]);

  return (
    <>
      {/* ... keep traffic, restriction, incident, truck layers unchanged ... */}

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
            style={{ lineColor: '#4CAF82', lineWidth: 3, lineOpacity: 1.0, lineCap: 'round', lineJoin: 'round' }}
          />
          <Mapbox.LineLayer
            id="traffic-moderate"
            sourceLayerID="traffic"
            slot="top"
            filter={['==', ['get', 'congestion'], 'moderate']}
            style={{ lineColor: '#FFBC40', lineWidth: 4, lineOpacity: 1.0, lineCap: 'round', lineJoin: 'round' }}
          />
          <Mapbox.LineLayer
            id="traffic-heavy"
            sourceLayerID="traffic"
            slot="top"
            filter={['==', ['get', 'congestion'], 'heavy']}
            style={{ lineColor: '#FF9100', lineWidth: 7, lineOpacity: 1.0, lineCap: 'round', lineJoin: 'round' }}
          />
          <Mapbox.LineLayer
            id="traffic-closed-bg"
            sourceLayerID="traffic"
            slot="top"
            filter={['any', ['==', ['get', 'congestion'], 'closed'], ['==', ['get', 'congestion'], 'severe']]}
            style={{ lineColor: '#FA0000', lineWidth: 9, lineOpacity: 1.0, lineCap: 'butt', lineJoin: 'miter' }}
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

      {/* ── Restriction Signs Layer ── */}
      {mapIsLoaded && restrictionPoints.length > 0 && (
        <Mapbox.ShapeSource id="restriction-signs-source" shape={restrictionGeoJSON}>
          {/* Sign background: White circle with red border (European style) */}
          <Mapbox.CircleLayer
            id="restriction-circles"
            slot="top"
            minZoomLevel={11}
            style={{
              circleRadius: 18,
              circleColor: '#FFFFFF',
              circleOpacity: 1.0,
              circleStrokeWidth: 3,
              circleStrokeColor: '#D0021B',
              circleStrokeOpacity: 1.0,
              circlePitchAlignment: 'viewport',
              ...((!lightMode) && { circleEmissiveStrength: 1.0 } as any),
            }}
          />
          <Mapbox.SymbolLayer
            id="restriction-signs"
            slot="top"
            minZoomLevel={11}
            style={{
              textField: [
                'concat',
                ['get', 'value'],
                ['match', ['get', 'type'], 'maxheight', 'м', 'maxweight', 'т', 'maxwidth', 'м', ''],
              ],
              textSize: 14,
              textColor: '#1A1A1A',
              textHaloColor: '#FFFFFF',
              textHaloWidth: 2.5,
              textAnchor: 'center',
              textAllowOverlap: true,
              textIgnorePlacement: true,
              textPitchAlignment: 'viewport',
              textEmissiveStrength: lightMode ? 0 : 1.0,
            } as any}
          />
        </Mapbox.ShapeSource>
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
        <Mapbox.ShapeSource id="route-source" shape={routeShape} tolerance={0}>
          <Mapbox.LineLayer
            id="route-casing"
            slot="middle"
            style={{
              lineColor: lightMode ? '#0a0a1a' : '#003d6b',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 5, 6, 10, 10, 15, 12],
              lineOpacity: 1.0,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <Mapbox.LineLayer
            id="route-line"
            slot="middle"
            style={{
              lineColor: ['match', ['get', 'congestion'],
                'low', lightMode ? routeLineColor : '#13BDFF',
                'moderate', '#FFBC40',
                'heavy', '#FF9100',
                'severe', '#FA0000',
                lightMode ? routeLineColor : '#13BDFF',
              ],
              lineWidth: ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 6, 15, 8],
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* ── Congestion overlay: 15 km ahead during navigation ── */}
      {mapIsLoaded && navigating && navCongestionVisible && navCongestionVisible.features.length > 0 && (
        <Mapbox.ShapeSource id="nav-congestion-src" shape={navCongestionVisible}>
          <Mapbox.LineLayer
            id="nav-congestion-line"
            slot="middle"
            style={{
              lineColor: ['match', ['get', 'congestion'],
                'low', routeLineColor,
                'moderate', '#FF9500',
                'heavy', '#FF3B30',
                'severe', '#8B0000',
                routeLineColor,
              ],
              lineWidth: 5,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* ── Route Arrows ── */}
      {mapIsLoaded && route && (
        <Mapbox.ShapeSource id="route-arrows-source" shape={{ type: 'Feature', properties: {}, geometry: route.geometry }}>
          <Mapbox.SymbolLayer
            id="route-direction-arrows"
            slot="top"
            style={{
              symbolPlacement: 'line', symbolSpacing: 80, textField: '▲', textSize: 14,
              textColor: 'rgba(255,255,255,0.85)', textHaloColor: 'rgba(0,0,0,0.30)', textHaloWidth: 1,
              textRotationAlignment: 'map', textAllowOverlap: true, iconAllowOverlap: true,
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* ── Turn Guidance Arrows (TomTom original icons) ── */}
      {mapIsLoaded && navigating && turnArrowsGeoJSON.features.length > 0 && (
        <Mapbox.ShapeSource id="turn-arrows-source" shape={turnArrowsGeoJSON}>
          <Mapbox.SymbolLayer
            id="turn-arrows-layer"
            slot="top"
            style={{
              textField: ['get', 'iconKey'],
              textSize: ['interpolate', ['linear'], ['zoom'], 11, 14, 14, 20, 17, 28],
              textColor: '#ffffff',
              textHaloColor: '#000000',
              textHaloWidth: 2,
              textAllowOverlap: true,
              textIgnorePlacement: true,
              textOpacity: ['interpolate', ['linear'], ['zoom'], 11, 0, 12, 1],
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
          <Mapbox.SymbolLayer
            id="dest-pin-layer"
            slot="top"
            style={{
              iconImage: 'dest-flag',
              iconSize: 0.6,
              iconAnchor: 'bottom',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconEmissiveStrength: lightMode ? 0 : 1.0,
            } as any}
          />
        </Mapbox.ShapeSource>
      )}

      {/* POI Pins (Parking, Fuel, Biz, Camera, etc.) */}
      {mapIsLoaded && parkingResults.length > 0 && (
        <Mapbox.ShapeSource
          id="parking-source"
          shape={parkingGeoJSON_withIdx}
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
            id="parking-symbols" slot="top" minZoomLevel={8}
            style={{
              textField: ['step', ['zoom'], 'P', 14, ['concat', 'P', '\n', ['case',
                ['>', ['coalesce', ['get', 'distance_m'], 0], 0],
                ['concat', ['to-string', ['round', ['/', ['coalesce', ['get', 'distance_m'], 0], 1000]]], ' km'],
                ''
              ]]],
              textSize: ['interpolate', ['linear'], ['zoom'], 6, 8, 10, 10, 12, 14, 18, 18],
              textColor: '#ffffff',
              textHaloColor: ['match', ['get', 'tachoStatus'],
                'safe', SAFE_GREEN,
                'warning', WARN_YELLOW,
                'danger', DANGER_RED,
                '#13BDFF'
              ],
              textHaloWidth: 1.8,
              textHaloBlur: 0.5,
              textAllowOverlap: true,
              textIgnorePlacement: true,
              textAnchor: 'center',
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Fuel station pins */}
      {mapIsLoaded && fuelResults.length > 0 && (
        <Mapbox.ShapeSource
          id="fuel-source"
          shape={fuelGeoJSON_withIdx}
          onPress={(e) => {
            const feat = e.features[0];
            if (!feat) return;
            const idx = feat.properties?.index;
            const f = fuelResults[idx];
            if (f) {
              setSelectedFuel(f);
              if (f.voice_desc && !voiceMutedRef.current) ttsSpeak(f.voice_desc);
            }
          }}
        >
          <Mapbox.SymbolLayer
            id="fuel-symbols" slot="top" minZoomLevel={7}
            style={{
              textField: ['step', ['zoom'], '⛽', 14, ['concat', '⛽', '\n', ['case',
                ['>', ['coalesce', ['get', 'distance_m'], 0], 0],
                ['concat', ['to-string', ['round', ['/', ['coalesce', ['get', 'distance_m'], 0], 1000]]], ' km'],
                ''
              ]]],
              textSize: ['interpolate', ['linear'], ['zoom'], 10, 10, 12, 13],
              textAnchor: 'top',
              textOffset: [0, 0.5],
              textHaloColor: '#1a1a2e',
              textHaloWidth: 2,
              textColor: '#ffffff',
              textAllowOverlap: true,
              iconAllowOverlap: true,
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Business pins */}
      {mapIsLoaded && businessResults.length > 0 && (
        <Mapbox.ShapeSource id="biz-source" shape={businessGeoJSON}>
          <Mapbox.SymbolLayer
            id="biz-symbols" slot="top"
            style={{
              textField: '🏢',
              textSize: 22,
              textHaloColor: '#f1c40f',
              textHaloWidth: 1.5,
              textAllowOverlap: true
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Camera pins */}
      {mapIsLoaded && cameraResults.length > 0 && (
        <Mapbox.ShapeSource id="camera-source" shape={cameraGeoJSON}>
          <Mapbox.SymbolLayer
            id="camera-emoji" slot="top" minZoomLevel={6}
            style={{
              textField: '📷',
              textSize: ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 14, 14, 18, 16, 22],
              textHaloColor: '#ff3b30',
              textHaloWidth: 1.5,
              textAnchor: 'bottom',
              textOffset: [0, 0.5],
              textAllowOverlap: true,
              textIgnorePlacement: true,
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
              textField: '🚫🚛',
              textSize: ['interpolate', ['linear'], ['zoom'], 7, 10, 12, 18, 14, 26],
              textHaloColor: '#ff3b30',
              textHaloWidth: 1.5,
              textAnchor: 'bottom',
              textAllowOverlap: true
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
            <Mapbox.ShapeSource id={`route-opt-src-${i}`} shape={(opt.congestion_geojson as unknown as GeoJSON.FeatureCollection) || { type: 'Feature', properties: {}, geometry: opt.geometry }} tolerance={0} onPress={() => handleSelectRouteOption(i)}>
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
