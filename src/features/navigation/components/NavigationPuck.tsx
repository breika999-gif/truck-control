import React from 'react';
import { LocationPuck } from '@rnmapbox/maps';

const NAV_PUCK_GLOW = '#6D3DFF';

interface NavigationPuckProps {
  speed: number;
  puckScale: number;
  navigating: boolean;
  isTracking: boolean;
}

const NavigationPuck: React.FC<NavigationPuckProps> = ({
  speed,
  puckScale,
  navigating,
  isTracking,
}) => (
  <LocationPuck
    puckBearingEnabled={speed > 3}
    puckBearing="course"
    topImage="nav-arrow"
    bearingImage="nav-arrow"
    scale={puckScale}
    pulsing={{ isEnabled: true, color: NAV_PUCK_GLOW, radius: 58 }}
    visible={navigating || isTracking}
  />
);

export default React.memo(NavigationPuck);
