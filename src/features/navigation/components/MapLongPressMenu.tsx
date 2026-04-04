import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { styles } from '../screens/MapScreen.styles';

interface MapLongPressMenuProps {
  coord: [number, number];
  hasDestination: boolean;
  waypointCount: number;
  onClose: () => void;
  onNavigate: (coord: [number, number], name: string) => void;
  onAddWaypoint: (coord: [number, number], name: string) => void;
  onStar: (coord: [number, number]) => void;
}

const MapLongPressMenu: React.FC<MapLongPressMenuProps> = ({
  coord,
  hasDestination,
  waypointCount,
  onClose,
  onNavigate,
  onAddWaypoint,
  onStar,
}) => {
  return (
    <View style={styles.longPressPopup}>
      {/* Header row */}
      <View style={styles.longPressHeader}>
        <Icon name="map-marker" size={18} color="#00bfff" />
        <Text style={styles.longPressTitle}> Избрана точка</Text>
        <TouchableOpacity style={styles.longPressCloseBtn} activeOpacity={0.7} onPress={onClose}>
          <Icon name="close" size={18} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      <Text style={styles.longPressCoords}>
        {coord[1].toFixed(5)}, {coord[0].toFixed(5)}
      </Text>

      {/* Action buttons */}
      <View style={styles.longPressBtns}>
        <TouchableOpacity
          style={styles.longPressBtn}
          activeOpacity={0.75}
          onPress={() => {
            onClose();
            onNavigate(coord, `${coord[1].toFixed(4)}, ${coord[0].toFixed(4)}`);
          }}
        >
          <View style={styles.longPressBtnInner}>
            <Icon name="navigation" size={20} color="#0a0c1c" />
            <Text style={styles.longPressBtnTxt}>Навигация</Text>
          </View>
        </TouchableOpacity>

        {hasDestination && (
          <TouchableOpacity
            style={[styles.longPressBtn, styles.longPressBtnWaypoint]}
            activeOpacity={0.75}
            onPress={() => {
              onClose();
              onAddWaypoint(coord, `Спирка ${waypointCount + 1}`);
            }}
          >
            <View style={styles.longPressBtnInner}>
              <Icon name="map-marker-plus" size={20} color="#0a0c1c" />
              <Text style={styles.longPressBtnTxt}>Добави спирка</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.longPressBtn, styles.longPressBtnStar]}
          activeOpacity={0.75}
          onPress={() => { onClose(); onStar(coord); }}
        >
          <View style={styles.longPressBtnInner}>
            <Text style={{ fontSize: 18 }}>⭐</Text>
            <Text style={styles.longPressBtnTxt}>Запази</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default MapLongPressMenu;
