import { useState } from 'react';

export type MapMode = 'vector' | 'hybrid' | 'satellite';

export const useMapUIState = () => {
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>('vector');
  const [lightMode, setLightMode] = useState(false);
  const [showTraffic, setShowTraffic] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showRestrictions, setShowRestrictions] = useState(false);
  const [showContours, setShowContours] = useState(false);
  const [showTerrain, setShowTerrain] = useState(false);
  const [trafficKey, setTrafficKey] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const [testLanesMode, setTestLanesMode] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showStarredLayer, setShowStarredLayer] = useState(true);

  return {
    mapLoaded, setMapLoaded,
    mapMode, setMapMode,
    lightMode, setLightMode,
    showTraffic, setShowTraffic,
    showIncidents, setShowIncidents,
    showRestrictions, setShowRestrictions,
    showContours, setShowContours,
    showTerrain, setShowTerrain,
    trafficKey, setTrafficKey,
    debugMode, setDebugMode,
    testLanesMode, setTestLanesMode,
    optionsOpen, setOptionsOpen,
    showStarredLayer, setShowStarredLayer,
  };
};
