import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

export const isTablet = width >= 768;
export const isLandscape = width > height;
export const uiScale = isTablet ? 1.25 : 1.0;
export const screenWidth = width;
