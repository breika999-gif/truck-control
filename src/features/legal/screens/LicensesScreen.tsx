import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  StyleSheet,
} from 'react-native';
import { APP_COPYRIGHT, MAP_ATTRIBUTION, THIRD_PARTY_ATTRIBUTIONS } from '../../../shared/legal/attributions';
import { colors, spacing, radius, typography } from '../../../shared/constants/theme';

export function LicensesScreen(): React.JSX.Element {
  function openUrl(url: string): void {
    Linking.openURL(url).catch(() => {});
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.appName}>TruckExpoAI</Text>
        <Text style={styles.copyright}>{APP_COPYRIGHT}</Text>
        <Text style={styles.mapAttribution}>{MAP_ATTRIBUTION}</Text>
      </View>

      <Text style={styles.sectionTitle}>Third-Party Licenses</Text>
      <Text style={styles.sectionNote}>
        This application uses the following open-source and third-party components:
      </Text>

      {THIRD_PARTY_ATTRIBUTIONS.map((item) => (
        <TouchableOpacity
          key={item.name}
          style={styles.card}
          onPress={() => openUrl(item.url)}
          activeOpacity={0.75}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.libName}>{item.name}</Text>
            {item.version ? (
              <Text style={styles.version}>v{item.version}</Text>
            ) : null}
          </View>
          {item.copyright ? (
            <Text style={styles.libCopyright}>{item.copyright}</Text>
          ) : null}
          <Text style={styles.licenseTag}>{item.license}</Text>
        </TouchableOpacity>
      ))}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Routing powered by TomTom N.V.{'\n'}
          AI powered by OpenAI &amp; Google DeepMind{'\n'}
          Maps powered by Mapbox &amp; OpenStreetMap
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.lg,
  },
  appName: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  copyright: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  mapAttribution: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: 'center',
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  libName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
  },
  version: {
    ...typography.label,
    color: colors.textMuted,
  },
  libCopyright: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  licenseTag: {
    ...typography.label,
    color: colors.accent,
    marginTop: spacing.xs,
  },
  footer: {
    marginTop: spacing.xl,
    padding: spacing.md,
    alignItems: 'center',
  },
  footerText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
