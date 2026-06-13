import React from 'react';
import type { ImageSourcePropType } from 'react-native';
import Mapbox from '@rnmapbox/maps';

interface MapImageRegistryProps {
  images: Record<string, ImageSourcePropType>;
}

const MapImageRegistry: React.FC<MapImageRegistryProps> = ({ images }) => (
  <Mapbox.Images
    images={images}
    onImageMissing={(_imageKey) => {
      // mapbox-location-shadow-icon е вграден Mapbox asset — не е грешка
    }}
  />
);

export default React.memo(MapImageRegistry);
