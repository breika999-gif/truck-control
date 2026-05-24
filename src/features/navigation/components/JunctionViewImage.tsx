import React from 'react';
import { Animated, StyleSheet } from 'react-native';

interface JunctionViewImageProps {
  imageBaseURL: string;
  accessToken: string;
}

const JunctionViewImage: React.FC<JunctionViewImageProps> = ({
  imageBaseURL,
  accessToken,
}) => {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = React.useState(false);

  const imageURL = React.useMemo(
    () => `${imageBaseURL}@2x.png?access_token=${accessToken}`,
    [accessToken, imageBaseURL],
  );

  React.useEffect(() => {
    setFailed(false);
    fadeAnim.setValue(0);
  }, [fadeAnim, imageURL]);

  const animatedStyle = React.useMemo(
    () => [junctionStyles.image, { opacity: fadeAnim }],
    [fadeAnim],
  );

  const handleLoad = React.useCallback(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleError = React.useCallback(() => {
    console.warn('[JunctionView] image load failed — token may lack access');
    setFailed(true);
  }, []);

  if (failed) return null;

  return (
    <Animated.Image
      source={{ uri: imageURL }}
      style={animatedStyle}
      resizeMode="contain"
      onLoad={handleLoad}
      onError={handleError}
    />
  );
};

const junctionStyles = StyleSheet.create({
  image: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});

export default React.memo(JunctionViewImage);
