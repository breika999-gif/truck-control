import React from 'react';
import { Alert, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fmtDistance } from '../api/directions';
import { styles } from '../screens/MapScreen.styles';

interface BusinessResultsPanelProps {
  businessResults: any[];
  searchTop: number;
  onDismiss: () => void;
  onNavigate: (coords: [number, number], name: string) => void;
  onAddWaypoint: (coords: [number, number], name: string) => void;
}

const BusinessResultsPanel: React.FC<BusinessResultsPanelProps> = ({
  businessResults,
  searchTop,
  onDismiss,
  onNavigate,
}) => {
  const { t } = useTranslation();

  if (businessResults.length === 0) return null;

  return (
    <View style={[styles.bizPanel, { top: searchTop + 58 }]}>
      <View style={styles.parkingPanelHeader}>
        <Text style={styles.bizPanelTitle}>📍 {t('panels.foundPlaces')}</Text>
        <TouchableOpacity onPress={onDismiss} style={styles.parkingDismissBtn}>
          <Text style={styles.parkingDismissTxt}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.parkingListContent}
      >
        {businessResults.map((b, i) => {
          const doNavigate = () => {
            onDismiss();
            onNavigate([b.lng, b.lat], b.name);
          };
          const statusMsg =
            b.business_status === 'CLOSED_PERMANENTLY' ? t('panels.closedPermanent') :
            b.business_status === 'CLOSED_TEMPORARILY' ? t('panels.closedTemporary') :
            t('panels.closedNow');
          return (
            <TouchableOpacity
              key={i}
              style={[styles.bizCard, b.needs_confirm ? styles.bizCardClosed : null]}
              activeOpacity={0.75}
              onPress={() => {
                if (b.needs_confirm) {
                  Alert.alert(
                    t('panels.warning'),
                    t('panels.drawRouteQuestion', { name: b.name, status: statusMsg }),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      { text: t('common.yesContinue'), onPress: doNavigate },
                    ],
                  );
                } else {
                  doNavigate();
                }
              }}
            >
              {b.source === 'google' && (
                <View style={styles.sourceBadge}>
                  <Text style={styles.sourceBadgeTxt}>Google</Text>
                </View>
              )}
              {b.photo_url ? (
                <Image source={{ uri: b.photo_url }} style={styles.bizCardPhoto} />
              ) : null}
              {b.needs_confirm ? (
                <View style={styles.bizClosedBadge}>
                  <Text style={styles.bizClosedBadgeTxt}>{statusMsg}</Text>
                </View>
              ) : null}
              <Text style={styles.bizCardName} numberOfLines={2}>{b.name}</Text>
              {b.distance_m > 0 && (
                <Text style={styles.bizCardDist}>{fmtDistance(b.distance_m)}</Text>
              )}
              {b.info ? (
                <Text style={styles.bizCardAddr} numberOfLines={2}>{b.info}</Text>
              ) : null}
              {b.review_summary ? (
                <Text style={styles.bizReviewSummary} numberOfLines={3}>{b.review_summary}</Text>
              ) : null}
              <Text style={styles.bizGoTxt}>🚀 {t('common.route')}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default React.memo(BusinessResultsPanel);
