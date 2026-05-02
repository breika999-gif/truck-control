import React from 'react';
import { Text, View } from 'react-native';
import type { RouteStep } from '../api/directions';
import { fmtDistance, maneuverEmoji } from '../api/directions';
import SignRenderer, { SIGN_TRIGGER_M } from './SignRenderer';
import { styles } from '../screens/MapScreen.styles';

interface NavigationTopPanelProps {
  visible: boolean;
  step: RouteStep;
  nextStep: RouteStep | null;
  distToTurn: number | null;
  lanes: any[];
  topOffset: number;
}

const NavigationTopPanel: React.FC<NavigationTopPanelProps> = ({
  visible,
  step,
  nextStep,
  distToTurn,
  lanes,
  topOffset,
}) => {
  if (!visible) return null;

  return (
    <View style={[styles.signWrap, { top: topOffset }]}>
      {distToTurn != null && distToTurn < SIGN_TRIGGER_M ? (
        <SignRenderer
          step={step}
          nextStep={nextStep ?? undefined}
          distToTurn={distToTurn}
          lanes={lanes}
          banner={step.bannerInstructions?.[0]}
        />
      ) : (
        <View style={styles.navBanner}>
          <Text style={styles.navArrow}>
            {maneuverEmoji(step.maneuver.type, step.maneuver.modifier)}
          </Text>
          <View style={styles.navBannerBody}>
            {distToTurn != null && (
              <Text style={[styles.navDistText, {
                fontSize: distToTurn > 20000 ? 28
                        : distToTurn > 10000 ? 24
                        : distToTurn > 5000  ? 22
                        : distToTurn > 2000  ? 20
                        : 18,
              }]}>
                {fmtDistance(distToTurn)}
              </Text>
            )}
            <Text style={styles.navStreet} numberOfLines={1}>
              {step.name || step.maneuver.instruction}
            </Text>
            {nextStep && (
              <Text style={styles.navNext} numberOfLines={1}>
                после:{' '}
                {maneuverEmoji(nextStep.maneuver.type, nextStep.maneuver.modifier)}{' '}
                {nextStep.name || nextStep.maneuver.instruction}
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

export default React.memo(NavigationTopPanel);
