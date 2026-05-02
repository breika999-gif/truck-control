const React = require('react');

const MapView = ({ children }) => React.createElement('View', null, children);
const Camera = () => null;
const UserLocation = () => null;
const Images = () => null;
const ShapeSource = ({ children }) => React.createElement('View', null, children);
const LineLayer = () => null;
const FillLayer = () => null;
const SymbolLayer = () => null;
const CircleLayer = () => null;
const RasterLayer = () => null;
const LocationPuck = () => null;
const Terrain = () => null;
const Atmosphere = () => null;
const SkyLayer = () => null;
const HeatmapLayer = () => null;

const locationManager = { start: jest.fn(), stop: jest.fn(), getLastKnownLocation: jest.fn() };

const UserTrackingMode = {
  Follow: 'normal',
  FollowWithHeading: 'compass',
  FollowWithCourse: 'course',
};

module.exports = {
  default: { MapView, Camera, UserLocation, Images, ShapeSource, LineLayer, FillLayer, SymbolLayer, CircleLayer, RasterLayer, LocationPuck, Terrain, Atmosphere, SkyLayer, HeatmapLayer },
  MapView, Camera, UserLocation, Images, ShapeSource, LineLayer, FillLayer, SymbolLayer, CircleLayer, RasterLayer, LocationPuck, Terrain, Atmosphere, SkyLayer, HeatmapLayer,
  locationManager,
  UserTrackingMode,
};
