import React from 'react';

import { HOS_LIMIT_S, getTransParkingUrl, openInBrowser, ttsSpeak } from '../../utils/mapUtils';
import BusinessResultsPanel from '../BusinessResultsPanel';
import FuelPanel from '../FuelPanel';
import FuelResultsPanel from '../FuelResultsPanel';
import ParkingBubble from '../ParkingBubble';
import ParkingResultsPanel from '../ParkingResultsPanel';
import POISearchResults from '../POISearchResults';
import TachoResultCard from '../TachoResultCard';
import type { Loose } from './types';

interface ResultsOverlayProps {
  routeUiCollapsed: boolean;
  navigating: boolean;
  route: Loose;
  sarMode: boolean;
  poiResults: Loose[];
  loadingPOI: boolean;
  searchTop: number;
  handlePOINavigate: Loose;
  clearPOI: Loose;
  parkingResults: Loose[];
  parkingSource?: 'gpt' | 'route' | null;
  setParkingResults: Loose;
  setParkingSource: Loose;
  navigateTo: Loose;
  addWaypoint: Loose;
  setSelectedParking: Loose;
  remainingDriveMin?: number;
  speedKmh?: number;
  navigation: Loose;
  userCoords: [number, number] | null;
  fuelResults: Loose[];
  setFuelResults: Loose;
  tachographResult: Loose;
  tachoSummary: Loose;
  setTachographResult: Loose;
  businessResults: Loose[];
  setBusinessResults: Loose;
  selectedParking: Loose;
  selectedFuel: Loose;
  setSelectedFuel: Loose;
  drivingSeconds: number;
}

const ResultsOverlay: React.FC<ResultsOverlayProps> = ({
  routeUiCollapsed,
  navigating,
  route,
  sarMode,
  poiResults,
  loadingPOI,
  searchTop,
  handlePOINavigate,
  clearPOI,
  parkingResults,
  parkingSource,
  setParkingResults,
  setParkingSource,
  navigateTo,
  addWaypoint,
  setSelectedParking,
  remainingDriveMin,
  speedKmh,
  navigation,
  userCoords,
  fuelResults,
  setFuelResults,
  tachographResult,
  tachoSummary,
  setTachographResult,
  businessResults,
  setBusinessResults,
  selectedParking,
  selectedFuel,
  setSelectedFuel,
  drivingSeconds,
}) => {
  const truckParkingRouteCoords = React.useMemo(() => {
    const coords = route?.geometry?.coordinates;
    if (!coords || coords.length < 2) return undefined;
    const max = 220;
    if (coords.length <= max) return coords;
    const step = Math.ceil(coords.length / max);
    const sampled = coords.filter((_: [number, number], i: number) => i % step === 0);
    const last = coords[coords.length - 1];
    return sampled[sampled.length - 1] === last ? sampled : [...sampled, last];
  }, [route]);

  return (
    <>
      {!navigating && (poiResults.length > 0 || loadingPOI) && (!route || sarMode) && (
        <POISearchResults
          poiResults={poiResults}
          loadingPOI={loadingPOI}
          sarMode={sarMode}
          searchTop={searchTop}
          onPOIPress={handlePOINavigate}
          onClearSAR={() => clearPOI()}
        />
      )}

      {(parkingSource === 'gpt' || (!route && !navigating)) && (
        <ParkingResultsPanel
          parkingResults={parkingResults}
          searchTop={searchTop}
          onDismiss={() => { setParkingResults([]); setParkingSource(null); }}
          onNavigate={(coords: [number, number], name: string) => navigateTo(coords, name)}
          onAddWaypoint={(coords: [number, number], name: string) => addWaypoint(coords, name)}
          onClearSelectedParking={() => setSelectedParking(null)}
          onCardTap={(p: Loose) => setSelectedParking(p)}
          remainingDriveMin={remainingDriveMin}
          speedKmh={speedKmh}
          onOpenInfo={async (p: Loose) => {
            const selectedCoords = p.lng != null && p.lat != null
              ? [p.lng, p.lat] as [number, number]
              : undefined;
            if (p.transparking_id) {
              const url = await getTransParkingUrl(p.transparking_id);
              navigation.navigate('TruckParking', {
                url,
                userCoords: userCoords || undefined,
                selectedCoords,
                selectedName: p.name,
                routeCoords: truckParkingRouteCoords,
                routeDurationS: route?.duration,
                remainingDriveMin,
              });
            } else if (p.website) {
              openInBrowser(p.website);
            } else {
              navigation.navigate('TruckParking', {
                userCoords: userCoords || undefined,
                selectedCoords,
                selectedName: p.name,
                routeCoords: truckParkingRouteCoords,
                routeDurationS: route?.duration,
                remainingDriveMin,
              });
            }
          }}
          onSpeak={(text: string) => ttsSpeak(text)}
        />
      )}

      {!route && (
        <FuelResultsPanel
          fuelResults={fuelResults}
          navigating={navigating}
          searchTop={searchTop}
          onDismiss={() => setFuelResults([])}
          onNavigate={(coords: [number, number], name: string) => navigateTo(coords, name)}
          onAddWaypoint={(coords: [number, number], name: string) => addWaypoint(coords, name)}
        />
      )}

      {!routeUiCollapsed && tachographResult && (
        <TachoResultCard
          result={tachographResult}
          tachoSummary={tachoSummary}
          onClose={() => setTachographResult(null)}
          onNavigate={navigateTo}
          topOffset={searchTop + 58}
        />
      )}

      {!navigating && (
        <BusinessResultsPanel
          businessResults={businessResults}
          searchTop={searchTop}
          onDismiss={() => setBusinessResults([])}
          onNavigate={(coords: [number, number], name: string) => navigateTo(coords, name)}
          onAddWaypoint={(coords: [number, number], name: string) => addWaypoint(coords, name)}
        />
      )}

      {!routeUiCollapsed && selectedParking && (
        <ParkingBubble
          parking={selectedParking}
          onClose={() => setSelectedParking(null)}
          onNavigate={navigateTo}
          onAddWaypoint={(coord: [number, number], name: string) => addWaypoint(coord, name)}
          onClearResults={() => setParkingResults([])}
          drivingSeconds={drivingSeconds}
          hosLimitS={HOS_LIMIT_S}
          topOffset={searchTop}
        />
      )}

      {!routeUiCollapsed && selectedFuel && (
        <FuelPanel
          fuel={selectedFuel}
          onClose={() => setSelectedFuel(null)}
          onAddWaypoint={(coord: [number, number], name: string) => addWaypoint(coord, name)}
          topOffset={searchTop}
        />
      )}
    </>
  );
};

export default ResultsOverlay;
