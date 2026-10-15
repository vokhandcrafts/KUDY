const React = require('react');
const { View } = require('react-native');
const cameraCalls = [];

// The native renderer cannot run in Jest. Keep its event props and marker
// children visible so screen tests can exercise fallback and camera policy.
const Map = ({ children, ...props }) => React.createElement(View, props, children);
const Marker = ({ children, id, lngLat, ...props }) =>
  React.createElement(View, { ...props, testID: `mock-map-marker-${id}`, lngLat }, children);
const Camera = ({ ref }) => {
  React.useImperativeHandle(ref, () => ({ easeTo: (options) => cameraCalls.push(options) }));
  return null;
};

module.exports = { Map, Marker, Camera, cameraCalls };
