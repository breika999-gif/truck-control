import React from 'react';
import { CustomLocationProvider } from '@rnmapbox/maps';

interface NavigationLocationProviderProps {
  navigating: boolean;
  displayCoords: [number, number] | null;
  userHeading: number | null;
}

const NavigationLocationProvider: React.FC<NavigationLocationProviderProps> = ({
  navigating,
  displayCoords,
  userHeading,
}) => {
  if (!navigating || !displayCoords) return null;

  return (
    <CustomLocationProvider
      coordinate={displayCoords}
      heading={userHeading ?? undefined}
    />
  );
};

export default React.memo(NavigationLocationProvider);
