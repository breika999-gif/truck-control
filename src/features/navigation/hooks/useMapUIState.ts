import { useState } from 'react';

export type MapMode = 'vector' | 'hybrid';

export interface MapLayersConfig {
  traffic: boolean;
  starred: boolean;
}

export const useMapUIState = () => {
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>('vector');
  const [lightMode, setLightMode] = useState(false);
  const [mapLayers, setMapLayers] = useState<MapLayersConfig>({
    traffic: true,
    starred: true,
  });
  const [trafficKey, setTrafficKey] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const toggleLayer = (layer: keyof MapLayersConfig) => {
    setMapLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  return {
    mapLoaded, setMapLoaded,
    mapMode, setMapMode,
    lightMode, setLightMode,
    mapLayers, setMapLayers,
    toggleLayer,
    trafficKey, setTrafficKey,
    optionsOpen, setOptionsOpen,
  };
};
