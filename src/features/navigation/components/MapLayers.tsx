import React, { memo } from 'react';
import { View, Text } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useTranslation } from 'react-i18next';
import type * as GeoJSON from 'geojson';
import { RouteResult } from '../api/directions';
import { RouteOption, POICard, SavedPOI } from '../../../shared/services/backendApi';
import { TruckPOI, POI_META } from '../api/poi';
import { MapLayersConfig } from '../hooks/useMapUIState';
import type { DriveSegmentsResult } from '../utils/driveSegments';
import type { GradeProfile } from '../utils/gradeProfile';

interface MapLayersProps {
  mapIsLoaded: boolean;
  mapMode: string;
  mapLayers: MapLayersConfig;
  navigating: boolean;
  trafficKey: number;
  lightMode: boolean;
  route: RouteResult | null;
  routeShape: GeoJSON.FeatureCollection | GeoJSON.Geometry | GeoJSON.Feature | null;
  congestionGeoJSON: GeoJSON.FeatureCollection | null;
  routeLineColor: string;
  routeProgressFraction?: number;
  driveSegments?: DriveSegmentsResult | null;
  gradeProfile?: GradeProfile | null;
  exitsGeoJSON: GeoJSON.FeatureCollection;
  navTrafficAlerts: GeoJSON.FeatureCollection | null;
  customOriginRef: React.MutableRefObject<[number, number] | null>;
  userCoords: [number, number] | null;
  destination: [number, number] | null;
  parkingResults: POICard[];
  reachMarker?: { coords: [number, number]; label: string } | null;
  fuelResults: POICard[];
  starredPOIs: SavedPOI[];
  businessResults: POICard[];
  cameraResults: any[];
  overtakingResults: any[]; 
  navCongestionVisible: GeoJSON.FeatureCollection | null;
  routeOptions: RouteOption[];
  selectedRouteIdx: number | null;
  setSelectedParking: (p: POICard) => void;
  setSelectedFuel: (f: POICard) => void;
  onRestMarkerPress?: (coords: [number, number]) => void;
  onBizMarkerPress: (business: POICard) => void;
  handleSelectRouteOption: (idx: number) => void;
  ttsSpeak: (text: string) => void;
  voiceMutedRef: React.MutableRefObject<boolean>;
  restrictionPoints?: RestrictionLayerPoint[];
  poiResults?: TruckPOI[];
  handlePOINavigate?: (poi: TruckPOI) => void;
}

type RestrictionLayerPoint = {
  lng: number;
  lat: number;
  type: 'maxheight' | 'maxweight' | 'maxwidth' | 'no_trucks' | 'hazmat';
  value: string;
  value_num?: number;
};

const POI_MARKER_SIZE = 36;
const NUMERIC_RESTRICTION_FILTER = ['==', ['get', 'numeric'], true] as const;
const ICON_RESTRICTION_FILTER = ['!=', ['get', 'numeric'], true] as const;

function buildLineGradient(stops: Array<{ fraction: number; color: string }>): unknown[] {
  const expression: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  const normalizedStops = stops
    .map(stop => ({ ...stop, fraction: Math.max(0, Math.min(1, stop.fraction)) }))
    .sort((a, b) => a.fraction - b.fraction)
    .filter((stop, index, sorted) => index === 0 || stop.fraction > sorted[index - 1].fraction);

  for (const stop of normalizedStops) {
    expression.push(stop.fraction, stop.color);
  }
  return expression;
}

function formatPOIDistance(distanceM?: number): string | null {
  if (distanceM == null || !Number.isFinite(distanceM)) return null;
  return distanceM >= 1000
    ? `${(distanceM / 1000).toFixed(1)}km`
    : `${Math.round(distanceM)}m`;
}

function isNumericRestriction(type: RestrictionLayerPoint['type']): boolean {
  return type === 'maxheight' || type === 'maxwidth' || type === 'maxweight';
}

function formatRestrictionLabel(point: RestrictionLayerPoint): string {
  if (!isNumericRestriction(point.type)) return '';
  const value = Number.isFinite(point.value_num)
    ? Number(point.value_num)
    : Number(String(point.value).replace(',', '.').split(/\s+/)[0]);
  if (!Number.isFinite(value) || value <= 0) return '';

  const rounded = value >= 10
    ? Math.round(value).toString()
    : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded}${point.type === 'maxweight' ? 't' : 'm'}`;
}

function toPointGeoJSON(
  items: Array<{ lng: number; lat: number }>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items
      .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
      .map((item, idx) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [item.lng, item.lat] },
        properties: { idx },
      })),
  };
}

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const midLatRad = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111320 * Math.cos(midLatRad);
  const dy = (b[1] - a[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

function routeFractions(coords: [number, number][]): number[] {
  if (coords.length <= 1) return coords.map(() => 0);
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += distanceMeters(coords[i - 1], coords[i]);
    cumulative[i] = total;
  }
  if (total <= 0) return coords.map((_, index) => index / Math.max(1, coords.length - 1));
  return cumulative.map(distance => distance / total);
}

function pointAtFraction(
  coords: [number, number][],
  fractions: number[],
  fraction: number,
): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];
  const target = clampFraction(fraction);
  for (let i = 1; i < fractions.length; i += 1) {
    if (target <= fractions[i] || i === fractions.length - 1) {
      const span = fractions[i] - fractions[i - 1];
      const t = span > 0 ? (target - fractions[i - 1]) / span : 0;
      const start = coords[i - 1];
      const end = coords[i];
      return [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ];
    }
  }
  return coords[coords.length - 1];
}

function routeSliceForFractions(
  coords: [number, number][],
  fractions: number[],
  start: number,
  end: number,
): [number, number][] {
  const from = clampFraction(Math.min(start, end));
  const to = clampFraction(Math.max(start, end));
  if (coords.length < 2 || to <= from) return [];

  const sliced: [number, number][] = [pointAtFraction(coords, fractions, from)];
  for (let i = 1; i < coords.length - 1; i += 1) {
    if (fractions[i] > from && fractions[i] < to) sliced.push(coords[i]);
  }
  sliced.push(pointAtFraction(coords, fractions, to));
  return sliced;
}

function buildGradeOverlayGeoJSON(
  route: RouteResult | null,
  gradeProfile?: GradeProfile | null,
): GeoJSON.FeatureCollection {
  const coords = route?.geometry.coordinates ?? [];
  if (coords.length < 2 || !gradeProfile?.steepSections.length) {
    return { type: 'FeatureCollection', features: [] };
  }
  const fractions = routeFractions(coords);
  return {
    type: 'FeatureCollection',
    features: gradeProfile.steepSections
      .map((section, index) => ({
        section,
        index,
        coordinates: routeSliceForFractions(coords, fractions, section.start, section.end),
      }))
      .filter(item => item.coordinates.length >= 2)
      .map(({ section, index, coordinates }) => ({
        type: 'Feature' as const,
        id: `grade-${index}`,
        properties: { grade: section.grade },
        geometry: { type: 'LineString' as const, coordinates },
      })),
  };
}

const POIMarker = ({
  symbol,
  accent,
  label,
  dark = true,
  symbolColor = '#ffffff',
  symbolSize = 17,
}: {
  symbol: string;
  accent: string;
  label?: string | null;
  dark?: boolean;
  symbolColor?: string;
  symbolSize?: number;
}) => (
  <View style={{ alignItems: 'center', width: 64 }}>
    <View style={{
      width: POI_MARKER_SIZE,
      height: POI_MARKER_SIZE,
      borderRadius: POI_MARKER_SIZE / 2,
      backgroundColor: dark ? '#091426' : '#ffffff',
      borderWidth: 2.5,
      borderColor: accent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: accent,
      shadowOpacity: 0.55,
      shadowRadius: 6,
      elevation: 5,
    }}>
      <Text style={{
        color: symbolColor,
        fontWeight: '900',
        fontSize: symbolSize,
        lineHeight: symbolSize + 4,
      }}>
        {symbol}
      </Text>
    </View>
    {label ? (
      <View style={{
        marginTop: 2,
        backgroundColor: 'rgba(0,0,0,0.78)',
        borderRadius: 6,
        paddingHorizontal: 5,
        paddingVertical: 1,
      }}>
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
          {label}
        </Text>
      </View>
    ) : null}
  </View>
);

const MapLayers: React.FC<MapLayersProps> = ({
  mapIsLoaded,
  mapMode,
  mapLayers,
  navigating,
  trafficKey,
  lightMode,
  route,
  routeShape,
  congestionGeoJSON,
  routeLineColor,
  routeProgressFraction,
  driveSegments,
  gradeProfile,
  exitsGeoJSON,
  navTrafficAlerts,
  customOriginRef,
  userCoords,
  destination,
  parkingResults,
  reachMarker,
  fuelResults,
  starredPOIs,
  businessResults,
  cameraResults,
  overtakingResults,
  navCongestionVisible,
  routeOptions,
  selectedRouteIdx,
  setSelectedParking,
  setSelectedFuel,
  onRestMarkerPress,
  onBizMarkerPress,
  handleSelectRouteOption,
  ttsSpeak,
  voiceMutedRef,
  restrictionPoints = [],
  poiResults = [],
  handlePOINavigate,
}) => {
  const { t } = useTranslation();

  const { traffic: showTraffic } = mapLayers;
  const hasDriveSegments = Boolean(driveSegments?.gradientStops.length);
  const routeGlowColor = lightMode ? 'rgba(0,122,255,0.30)' : 'rgba(19,217,255,0.52)';
  const routeCasingColor = lightMode ? '#071426' : '#06244A';
  const routeBaseColor = hasDriveSegments ? 'rgba(0,0,0,0)' : routeLineColor;
  const routeMainWidth = ['interpolate', ['linear'], ['zoom'], 5, 5, 10, 9, 15, 15] as any;
  const routeCasingWidth = ['interpolate', ['linear'], ['zoom'], 5, 8, 10, 14, 15, 23] as any;
  const routeGlowWidth = ['interpolate', ['linear'], ['zoom'], 5, 13, 10, 22, 15, 36] as any;
  const gradeOverlayGeoJSON = React.useMemo(
    () => buildGradeOverlayGeoJSON(route, gradeProfile),
    [gradeProfile, route],
  );

  const restrictionGeoJSON = React.useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: restrictionPoints
      .filter(rp => Number.isFinite(rp.lat) && Number.isFinite(rp.lng))
      .map((rp, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [rp.lng, rp.lat] },
        properties: {
          value: rp.value,
          value_num: rp.value_num,
          label: formatRestrictionLabel(rp),
          numeric: isNumericRestriction(rp.type),
          type: rp.type,
        },
      })),
  }), [restrictionPoints]);

  const parkingGeoJSON = React.useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: parkingResults
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map(({ p, idx }) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: {
          idx,
          label: formatPOIDistance(p.distance_m) ?? '',
          safe: p.safe === true,
          paid: p.paid === true,
          security: p.security === true,
          showers: p.showers === true,
        },
      })),
  }), [parkingResults]);

  const originCoords = customOriginRef.current ?? userCoords;

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
            slot="top"
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
          <Mapbox.CircleLayer
            id="restriction-numeric-signs"
            slot="top"
            filter={NUMERIC_RESTRICTION_FILTER as any}
            minZoomLevel={8}
            style={{
              circleColor: '#FFFFFF',
              circleOpacity: 0.98,
              circleRadius: [
                'interpolate', ['linear'], ['zoom'],
                8, 8,
                12, 11,
                15, 15,
                17, 18,
              ],
              circleStrokeColor: '#D0021B',
              circleStrokeOpacity: 1,
              circleStrokeWidth: [
                'interpolate', ['linear'], ['zoom'],
                8, 2.5,
                12, 3,
                15, 4,
                17, 4.5,
              ],
            } as any}
          />
          <Mapbox.SymbolLayer
            id="restriction-numeric-labels"
            slot="top"
            filter={NUMERIC_RESTRICTION_FILTER as any}
            minZoomLevel={8}
            style={{
              textField: ['get', 'label'],
              textSize: [
                'interpolate', ['linear'], ['zoom'],
                8, 7,
                12, 9,
                15, 11,
                17, 13,
              ],
              textColor: '#050505',
              textHaloColor: '#FFFFFF',
              textHaloWidth: 0.4,
              textAnchor: 'center',
              textAllowOverlap: true,
              textIgnorePlacement: true,
              textPitchAlignment: 'viewport',
              textRotationAlignment: 'viewport',
            } as any}
          />
          <Mapbox.SymbolLayer
            id="restriction-signs"
            slot="top"
            filter={ICON_RESTRICTION_FILTER as any}
            minZoomLevel={8}
            style={{
              iconImage: [
                'match',
                ['coalesce', ['get', 'restriction_type'], ['get', 'type']],
                'maxheight', 'restriction-height',
                'maxwidth', 'restriction-width',
                'maxweight', 'restriction-weight',
                'maxaxleload', 'restriction-axle',
                'maxlength', 'restriction-length',
                'no_trucks', 'restriction-no-trucks',
                'hazmat', 'restriction-hazmat',
                'adr_tunnel', 'restriction-adr',
                'restriction-no-trucks',
              ],
              iconSize: [
                'interpolate', ['linear'], ['zoom'],
                8, 0.16,
                12, 0.28,
                15, 0.38,
                17, 0.45,
              ],
              iconOpacity: [
                'interpolate', ['linear'], ['zoom'],
                12, 0.8,
                15, 1.0,
              ],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconAnchor: 'center',
              iconPitchAlignment: 'viewport',
              iconRotationAlignment: 'viewport',
              iconEmissiveStrength: lightMode ? 0 : 1.0,
            } as any}
          />
        </Mapbox.ShapeSource>
      )}

      {/* ── Incidents overlay ── */}
      {mapIsLoaded && mapMode !== 'satellite' && (
        <Mapbox.VectorSource id="incidents-v1" url="mapbox://mapbox.mapbox-traffic-v1">
          <Mapbox.SymbolLayer
            id="incident-signs-point"
            slot="top"
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
            slot="top"
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
            slot="top"
            sourceLayerID="incidents"
            filter={['==', ['geometry-type'], 'LineString']}
            style={{ lineColor: '#e74c3c', lineWidth: 6, lineOpacity: 1.0, lineCap: 'butt', lineDasharray: [2, 2] }}
          />
        </Mapbox.VectorSource>
      )}

      {/* ── Truck restrictions ── */}
      {mapIsLoaded && mapMode !== 'satellite' && (
        <Mapbox.VectorSource id="streets-v8" url="mapbox://mapbox.mapbox-streets-v8">
          <Mapbox.LineLayer
            id="truck-bridge-warning"
            slot="middle"
            aboveLayerID="route-line"
            sourceLayerID="road"
            filter={['==', ['get', 'structure'], 'bridge']}
            minZoomLevel={10}
            style={{ lineColor: lightMode ? '#0077aa' : '#00bbee', lineWidth: 5, lineOpacity: lightMode ? 0.38 : 0.32, lineCap: 'round' }}
          />
          <Mapbox.LineLayer
            id="truck-tunnel-warning"
            slot="middle"
            aboveLayerID="route-line"
            sourceLayerID="road"
            filter={['==', ['get', 'structure'], 'tunnel']}
            minZoomLevel={10}
            style={{ lineColor: lightMode ? '#e07000' : '#ffaa33', lineWidth: 6, lineOpacity: lightMode ? 0.62 : 0.52, lineDasharray: [2, 2], lineCap: 'round' }}
          />
        </Mapbox.VectorSource>
      )}

      {/* ── Route glow + casing (thick glass navigation tube) ── */}
      {mapIsLoaded && routeShape && (
        <Mapbox.ShapeSource id="route-source" shape={routeShape} tolerance={0} lineMetrics={true}>
          <Mapbox.LineLayer
            id="route-glow"
            slot="middle"
            style={{
              lineColor: routeGlowColor,
              lineWidth: routeGlowWidth,
              lineOpacity: lightMode ? 0.42 : 0.72,
              lineBlur: ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 5, 15, 8] as any,
              lineCap: 'round',
              lineJoin: 'round',
              lineTrimOffset: [0, routeProgressFraction ?? 0] as [number, number],
            } as any}
          />
          <Mapbox.LineLayer
            id="route-casing"
            slot="middle"
            aboveLayerID="route-glow"
            style={{
              lineColor: routeCasingColor,
              lineWidth: routeCasingWidth,
              lineOpacity: lightMode ? 0.92 : 1.0,
              lineCap: 'round',
              lineJoin: 'round',
              lineTrimOffset: [0, routeProgressFraction ?? 0] as [number, number],
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
          <Mapbox.ShapeSource id="route-congestion-source" shape={shape} tolerance={0} lineMetrics={true}>
            <Mapbox.LineLayer
              id="route-line"
              slot="middle"
              aboveLayerID="route-casing"
              style={{
                lineColor: ['match', ['get', 'congestion'],
                  'low', routeBaseColor,
                  'moderate', '#FFBC40',
                  'heavy', '#FF9100',
                  'severe', '#FA0000',
                  routeBaseColor,
                ],
                lineWidth: routeMainWidth,
                lineOpacity: 0.98,
                lineCap: 'round',
                lineJoin: 'round',
                lineBlur: lightMode ? 0 : 0.25,
                lineEmissiveStrength: lightMode ? 0 : 1.2,
                lineTrimOffset: [0, routeProgressFraction ?? 0] as [number, number],
              } as any}
            />
          </Mapbox.ShapeSource>
        );
      })()}

      {/* ── Tachograph drive periods (visible route surface) ── */}
      {mapIsLoaded && driveSegments && routeShape && driveSegments.gradientStops.length > 0 && (
        <Mapbox.ShapeSource
          id="drive-segments-source"
          lineMetrics={true}
          shape={routeShape}
        >
          <Mapbox.LineLayer
            id="drive-segments-layer"
            slot="middle"
            aboveLayerID="route-line"
            style={{
              lineWidth: routeMainWidth,
              lineOpacity: 0.98,
              lineCap: 'round',
              lineJoin: 'round',
              lineGradient: buildLineGradient(driveSegments.gradientStops),
              lineBlur: lightMode ? 0 : 0.2,
              lineEmissiveStrength: lightMode ? 0 : 1.15,
              lineTrimOffset: [0, routeProgressFraction ?? 0] as [number, number],
            } as any}
          />
        </Mapbox.ShapeSource>
      )}

      {mapIsLoaded && hasDriveSegments && gradeOverlayGeoJSON.features.length > 0 && (
        <Mapbox.ShapeSource id="grade-overlay-source" shape={gradeOverlayGeoJSON}>
          <Mapbox.LineLayer
            id="grade-overlay"
            slot="middle"
            aboveLayerID="drive-segments-layer"
            style={{
              lineColor: '#FF6B00',
              lineWidth: 5,
              lineOpacity: 0.65,
              lineCap: 'round',
              lineJoin: 'round',
              lineEmissiveStrength: lightMode ? 0 : 1.1,
            } as any}
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
              symbolPlacement: 'line', symbolSpacing: 110, textField: '▲',
              textSize: ['interpolate', ['linear'], ['zoom'], 10, 12, 15, 18] as any,
              textColor: 'rgba(255,255,255,0.92)', textHaloColor: 'rgba(0,190,255,0.45)', textHaloWidth: 1.4,
              textRotationAlignment: 'map', textAllowOverlap: true, iconAllowOverlap: true,
            } as any}
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

      {mapIsLoaded && driveSegments?.restPoints.map((restPoint, index) => (
        <Mapbox.PointAnnotation
          key={`drive-rest-${index}-${restPoint.coords[0].toFixed(5)}-${restPoint.coords[1].toFixed(5)}`}
          id={`drive-rest-${index}`}
          coordinate={restPoint.coords}
          onSelected={() => onRestMarkerPress?.(restPoint.coords)}
        >
          <POIMarker
            symbol="⛺"
            accent={restPoint.restHours === 9 ? '#FF9500' : '#9B59B6'}
            label={t('route.restHours', { hours: restPoint.restHours })}
            symbolSize={16}
          />
        </Mapbox.PointAnnotation>
      ))}

      {/* Origin/Dest Pins */}
      {(route || navigating) && originCoords && (
        <Mapbox.ShapeSource
          id="origin-pin-src"
          shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: originCoords }, properties: {} }}
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
              iconSize: 0.34,
              iconAnchor: 'bottom',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconEmissiveStrength: lightMode ? 0 : 1.0,
            } as any}
          />
        </Mapbox.ShapeSource>
      )}

      {/* POI Pins (Parking) — ShapeSource keeps taps reliable on Mapbox */}
      {mapIsLoaded && parkingGeoJSON.features.length > 0 && (
        <Mapbox.ShapeSource
          id="parking-source"
          shape={parkingGeoJSON}
          onPress={e => {
            const idx = e.features[0]?.properties?.idx as number | undefined;
            if (idx != null) {
              const p = parkingResults[idx];
              if (p) {
                setSelectedParking(p);
                if (p.voice_desc && !voiceMutedRef.current) ttsSpeak(p.voice_desc);
              }
            }
          }}
        >
          <Mapbox.CircleLayer
            id="parking-halo"
            slot="top"
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 9, 18, 14, 25, 17, 31] as any,
              circleColor: '#061426',
              circleStrokeColor: '#13BDFF',
              circleStrokeWidth: ['interpolate', ['linear'], ['zoom'], 9, 2.5, 15, 4] as any,
              circleOpacity: 0.92,
              circleStrokeOpacity: 1,
              circlePitchAlignment: 'viewport',
              circleEmissiveStrength: lightMode ? 0 : 1,
            } as any}
          />
          <Mapbox.CircleLayer
            id="parking-quality-dot"
            slot="top"
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 9, 4, 15, 6] as any,
              circleTranslate: [14, -14],
              circleColor: [
                'case',
                ['get', 'security'], '#00ff88',
                ['get', 'showers'], '#62d9ff',
                ['get', 'paid'], '#ffcc00',
                '#8b93ff',
              ] as any,
              circleStrokeColor: '#07111f',
              circleStrokeWidth: 1.5,
              circlePitchAlignment: 'viewport',
              circleEmissiveStrength: lightMode ? 0 : 1,
            } as any}
          />
          <Mapbox.SymbolLayer
            id="parking-letter"
            slot="top"
            style={{
              textField: 'P',
              textSize: ['interpolate', ['linear'], ['zoom'], 9, 18, 14, 25, 17, 29] as any,
              textColor: '#13BDFF',
              textHaloColor: '#061426',
              textHaloWidth: 1.5,
              textAllowOverlap: true,
              textIgnorePlacement: true,
              textPitchAlignment: 'viewport',
              textEmissiveStrength: lightMode ? 0 : 1,
            } as any}
          />
          <Mapbox.SymbolLayer
            id="parking-distance-label"
            slot="top"
            minZoomLevel={10}
            style={{
              textField: ['get', 'label'],
              textSize: 11,
              textColor: '#ffffff',
              textHaloColor: '#061426',
              textHaloWidth: 3,
              textOffset: [0, 2.15],
              textAllowOverlap: true,
              textIgnorePlacement: true,
              textPitchAlignment: 'viewport',
              textEmissiveStrength: lightMode ? 0 : 1,
            } as any}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Reach marker — deterministic "дотук стигаш" point on active route */}
      {mapIsLoaded && reachMarker && (
        <>
          <Mapbox.ShapeSource
            id="reach-pulse-source"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: reachMarker.coords },
            }}
          >
            <Mapbox.CircleLayer
              id="reach-pulse"
              slot="top"
              style={{
                circleRadius: 18,
                circleColor: 'rgba(255, 149, 0, 0)',
                circleStrokeWidth: 3,
                circleStrokeColor: '#FF9500',
                circleStrokeOpacity: 0.7,
                circlePitchAlignment: 'map',
              }}
            />
          </Mapbox.ShapeSource>
          <Mapbox.PointAnnotation
            key={`reach-marker-${reachMarker.coords[0].toFixed(5)}-${reachMarker.coords[1].toFixed(5)}`}
            id="reach-marker"
            coordinate={reachMarker.coords}
          >
            <View style={{
              alignItems: 'center',
              backgroundColor: 'rgba(255, 149, 0, 0.92)',
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderWidth: 2,
              borderColor: '#FF9500',
              shadowColor: '#FF9500',
              shadowRadius: 6,
              shadowOpacity: 0.7,
              elevation: 8,
            }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                {reachMarker.label}
              </Text>
            </View>
          </Mapbox.PointAnnotation>
        </>
      )}

      {/* Manual POI Search Results (poiResults) — PointAnnotation */}
      {mapIsLoaded && poiResults.map((p, i) => (
        <Mapbox.PointAnnotation
          key={`poi-res-pin-${i}`}
          id={`poi-res-pin-${i}`}
          coordinate={p.coordinates}
          onSelected={() => handlePOINavigate && handlePOINavigate(p)}
        >
          <POIMarker
            symbol={POI_META[p.category]?.emoji || '📍'}
            accent={p.category === 'gas_station' ? '#f59e0b' : '#13BDFF'}
            symbolSize={16}
          />
        </Mapbox.PointAnnotation>
      ))}

      {/* Fuel station pins — SymbolLayer (GPU-rendered, 3D-aware) */}
      {mapIsLoaded && fuelResults.length > 0 && (
        <Mapbox.ShapeSource
          id="fuel-source"
          shape={toPointGeoJSON(fuelResults)}
          onPress={e => {
            const idx = e.features[0]?.properties?.idx as number | undefined;
            if (idx != null) {
              const f = fuelResults[idx];
              if (f) {
                setSelectedFuel(f);
                if (f.voice_desc && !voiceMutedRef.current) ttsSpeak(f.voice_desc);
              }
            }
          }}
        >
          <Mapbox.SymbolLayer
            id="fuel-symbols"
            style={{
              iconImage: 'fuel-icon',
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.65, 18, 1.0] as unknown as number,
              iconPitchAlignment: 'viewport',
              iconAllowOverlap: false,
              iconAnchor: 'bottom',
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Starred Places — SymbolLayer */}
      {mapIsLoaded && starredPOIs.length > 0 && (
        <Mapbox.ShapeSource
          id="starred-source"
          shape={toPointGeoJSON(starredPOIs)}
        >
          <Mapbox.SymbolLayer
            id="starred-symbols"
            style={{
              iconImage: 'star-icon',
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.65, 18, 1.0] as unknown as number,
              iconPitchAlignment: 'viewport',
              iconAllowOverlap: false,
              iconAnchor: 'bottom',
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Business pins — SymbolLayer */}
      {mapIsLoaded && businessResults.length > 0 && (
        <Mapbox.ShapeSource
          id="biz-source"
          shape={toPointGeoJSON(businessResults)}
          onPress={e => {
            const idx = e.features[0]?.properties?.idx as number | undefined;
            if (idx != null) {
              const business = businessResults[idx];
              if (business) onBizMarkerPress(business);
            }
          }}
        >
          <Mapbox.SymbolLayer
            id="biz-symbols"
            style={{
              iconImage: 'biz-icon',
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.65, 18, 1.0] as unknown as number,
              iconPitchAlignment: 'viewport',
              iconAllowOverlap: false,
              iconAnchor: 'bottom',
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Camera pins — SymbolLayer */}
      {mapIsLoaded && cameraResults.length > 0 && (
        <Mapbox.ShapeSource
          id="camera-source"
          shape={toPointGeoJSON(cameraResults)}
        >
          <Mapbox.SymbolLayer
            id="camera-symbols"
            slot="top"
            style={{
              iconImage: 'camera-icon',
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.45, 14, 0.85, 18, 1.3] as unknown as number,
              iconPitchAlignment: 'viewport',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconAnchor: 'bottom',
              iconEmissiveStrength: lightMode ? 0 : 1.0,
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Overtaking restrictions — SymbolLayer */}
      {mapIsLoaded && overtakingResults.length > 0 && (
        <Mapbox.ShapeSource
          id="overtaking-source"
          shape={toPointGeoJSON(overtakingResults)}
        >
          <Mapbox.SymbolLayer
            id="overtaking-symbols"
            slot="top"
            style={{
              iconImage: 'no-overtaking',
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.45, 14, 0.85, 18, 1.3] as unknown as number,
              iconPitchAlignment: 'viewport',
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconAnchor: 'bottom',
              iconEmissiveStrength: lightMode ? 0 : 1.0,
            }}
          />
        </Mapbox.ShapeSource>
      )}

      {/* Route alternatives */}
      {mapIsLoaded && routeOptions.map((opt, i) => {
        const effectiveSelectedRouteIdx = selectedRouteIdx ?? (routeOptions.length > 0 ? 0 : null);
        const isSelected = effectiveSelectedRouteIdx === i;
        if (isSelected && route) return null;
        const coords = opt.geometry.coordinates;
        const midCoord = coords[Math.floor(coords.length / 2)] as [number, number];
        const fastestDuration = routeOptions[0]?.duration ?? 0;
        const diffMin = Math.round((opt.duration - fastestDuration) / 60);
        const timeLabel = i === 0
          ? t('route.fastest')
          : diffMin > 0
            ? `+${diffMin} ${t('routeOptions.minutesShort')}`
            : diffMin < 0
              ? `${diffMin} ${t('routeOptions.minutesShort')}`
              : t('route.equal');
        
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
            <Mapbox.ShapeSource id={`route-opt-label-src-${i}`} shape={{ type: 'Feature', properties: { label: timeLabel }, geometry: { type: 'Point', coordinates: midCoord } }}>
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
