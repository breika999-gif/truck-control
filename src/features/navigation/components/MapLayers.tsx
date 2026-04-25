import React, { memo } from 'react';
import { View, Text } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import type * as GeoJSON from 'geojson';
import { RouteResult } from '../api/directions';
import { RouteOption, POICard } from '../../../shared/services/backendApi';
import { TruckPOI, POI_META } from '../api/poi';

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
  congestionGeoJSON: GeoJSON.FeatureCollection | null;
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
  poiResults?: TruckPOI[];
  poiResultsGeoJSON?: GeoJSON.FeatureCollection;
  handlePOINavigate?: (poi: TruckPOI) => void;
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
  congestionGeoJSON,
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
  poiResults = [],
  poiResultsGeoJSON,
  handlePOINavigate,
}) => {

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
            style={{ lineColor: '#FA0000', lineWidth: 9, lineOpacity: 1.0, lineCap: 'round', lineJoin: 'round' }}
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
              lineCap: 'round',
              lineJoin: 'round',
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
            minZoomLevel={9}
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
            minZoomLevel={9}
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

      {/* ── Route casing (dark border) ── */}
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
        </Mapbox.ShapeSource>
      )}

      {/* ── Route congestion line (colored segments from TomTom data) ── */}
      {mapIsLoaded && (() => {
        // During navigation: show 15km slice; in preview: show full route
        const shape = navigating
          ? (navCongestionVisible && navCongestionVisible.features.length > 0 ? navCongestionVisible : congestionGeoJSON)
          : congestionGeoJSON;
        return shape && (
          <Mapbox.ShapeSource id="route-congestion-source" shape={shape} tolerance={0}>
            <Mapbox.LineLayer
              id="route-line"
              slot="middle"
              aboveLayerID="route-casing"
              style={{
                lineColor: ['match', ['get', 'congestion'],
                  'low', routeLineColor,
                  'moderate', '#FFBC40',
                  'heavy', '#FF9100',
                  'severe', '#FA0000',
                  routeLineColor,
                ],
                lineWidth: ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 6, 15, 8],
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </Mapbox.ShapeSource>
        );
      })()}

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
      {(route || navigating) && (customOriginRef.current || userCoords) && (
        <Mapbox.ShapeSource
          id="origin-pin-src"
          shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: customOriginRef.current ?? userCoords ?? null }, properties: {} }}
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

      {/* POI Pins (Parking) — MarkerView for custom React Native views */}
      {mapIsLoaded && parkingResults.filter(p => p.lat && p.lng).map((p, i) => (
        <Mapbox.MarkerView
          key={`parking-pin-${i}`}
          id={`parking-pin-${i}`}
          coordinate={[p.lng, p.lat]}
          allowOverlap
        >
          <View
            style={{ alignItems: 'center' }}
            onTouchEnd={() => {
              setSelectedParking(p);
              if (p.voice_desc && !voiceMutedRef.current) ttsSpeak(p.voice_desc);
            }}
          >
            <View style={{
              width: 36, height: 36,
              borderRadius: 18,
              backgroundColor: '#0a1a2e',
              borderWidth: 2.5,
              borderColor: '#13BDFF',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#13BDFF',
              shadowOpacity: 0.5,
              shadowRadius: 6,
              elevation: 4,
            }}>
              <Text style={{ color: '#13BDFF', fontWeight: 'bold', fontSize: 16 }}>P</Text>
            </View>
            {p.distance_m != null && (
              <View style={{
                marginTop: 2,
                backgroundColor: 'rgba(0,0,0,0.75)',
                borderRadius: 6,
                paddingHorizontal: 4,
                paddingVertical: 1,
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
                  {p.distance_m >= 1000 ? `${(p.distance_m / 1000).toFixed(1)}km` : `${Math.round(p.distance_m)}m`}
                </Text>
              </View>
            )}
          </View>
        </Mapbox.MarkerView>
      ))}

      {/* Manual POI Search Results (poiResults) — PointAnnotation */}
      {mapIsLoaded && poiResults.map((p, i) => (
        <Mapbox.PointAnnotation
          key={`poi-res-pin-${i}`}
          id={`poi-res-pin-${i}`}
          coordinate={p.coordinates}
          onSelected={() => handlePOINavigate && handlePOINavigate(p)}
        >
          <View style={{
            padding: 4,
            backgroundColor: 'rgba(15,15,30,0.85)',
            borderRadius: 20,
            borderWidth: 1,
            borderColor: '#13BDFF',
          }}>
            <Text style={{ fontSize: 18 }}>{POI_META[p.category]?.emoji || '📍'}</Text>
          </View>
        </Mapbox.PointAnnotation>
      ))}

      {/* Fuel station pins — PointAnnotation */}
      {mapIsLoaded && fuelResults.filter(f => f.lat && f.lng).map((f, i) => (
        <Mapbox.PointAnnotation
          key={`fuel-pin-${i}`}
          id={`fuel-pin-${i}`}
          coordinate={[f.lng, f.lat]}
          onSelected={() => {
            setSelectedFuel(f);
            if (f.voice_desc && !voiceMutedRef.current) ttsSpeak(f.voice_desc);
          }}
        >
          <View style={{
            width: 30, height: 30,
            borderRadius: 15,
            backgroundColor: '#1a1a2e',
            borderWidth: 2,
            borderColor: '#f59e0b',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#f59e0b',
            shadowOpacity: 0.6,
            shadowRadius: 4,
            elevation: 5,
          }}>
            <Text style={{ fontSize: 16 }}>⛽</Text>
          </View>
        </Mapbox.PointAnnotation>
      ))}

      {/* Business pins — PointAnnotation */}
      {mapIsLoaded && businessResults.filter(b => b.lat && b.lng).map((b, i) => (
        <Mapbox.PointAnnotation
          key={`biz-pin-${i}`}
          id={`biz-pin-${i}`}
          coordinate={[b.lng, b.lat]}
        >
          <View style={{
            width: 28, height: 28,
            borderRadius: 14,
            backgroundColor: 'rgba(0,40,60,0.92)',
            borderWidth: 2,
            borderColor: '#00e5ff',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 16 }}>🏢</Text>
          </View>
        </Mapbox.PointAnnotation>
      ))}

      {/* Camera pins — PointAnnotation */}
      {mapIsLoaded && cameraResults.filter(c => c.lat && c.lng).map((c, i) => (
        <Mapbox.PointAnnotation
          key={`camera-pin-${i}`}
          id={`camera-pin-${i}`}
          coordinate={[c.lng, c.lat]}
        >
          <View style={{
            backgroundColor: 'rgba(30,0,0,0.9)',
            borderRadius: 6,
            padding: 4,
            borderWidth: 1.5,
            borderColor: '#ff3b30',
            alignItems: 'center',
          }}>
            <Text style={{ fontSize: 16 }}>📷</Text>
            {c.maxspeed && (
              <Text style={{ color: '#ff3b30', fontSize: 8, fontWeight: '800' }}>{c.maxspeed}</Text>
            )}
          </View>
        </Mapbox.PointAnnotation>
      ))}

      {/* Overtaking restrictions — PointAnnotation */}
      {mapIsLoaded && overtakingResults.filter(r => r.lat && r.lng).map((r, i) => (
        <Mapbox.PointAnnotation
          key={`overtaking-pin-${i}`}
          id={`overtaking-pin-${i}`}
          coordinate={[r.lng, r.lat]}
        >
          <View style={{
            width: 32, height: 32,
            borderRadius: 16,
            backgroundColor: '#fff',
            borderWidth: 3,
            borderColor: '#ff3b30',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 14 }}>🚫🚛</Text>
          </View>
        </Mapbox.PointAnnotation>
      ))}

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
                  lineColor: opt.congestion_geojson ? ['match', ['get', 'congestion'], 'low', '#0A84FF', 'moderate', '#ffcc00', 'heavy', '#ff4444', 'severe', '#8b0000', '#0A84FF'] : opt.color,
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
