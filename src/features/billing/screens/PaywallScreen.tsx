import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { PurchasesPackage } from 'react-native-purchases';
import { colors } from '../../../shared/constants/theme';
import { useSubscription } from '../hooks/useSubscription';

function packageLabel(pkg: PurchasesPackage): string {
  const title = pkg.product.title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (title) return title;
  if (pkg.identifier.includes('annual') || pkg.identifier.includes('year')) return 'Yearly';
  if (pkg.identifier.includes('month')) return 'Monthly';
  return pkg.identifier;
}

const PaywallScreen: React.FC = () => {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const {
    configured,
    isPro,
    packages,
    loading,
    busyPackageId,
    restoring,
    error,
    purchase,
    restore,
    refresh,
  } = useSubscription();

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.75}>
          <Icon name="arrow-left" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('billing.title')}</Text>
        <TouchableOpacity onPress={refresh} style={s.backBtn} activeOpacity={0.75}>
          <Icon name="refresh" size={22} color="rgba(255,255,255,0.75)" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={s.crown}>
            <Icon name="crown" size={44} color="#FFD166" />
          </View>
          <Text style={s.title}>{isPro ? t('billing.activeTitle') : t('billing.heroTitle')}</Text>
          <Text style={s.subtitle}>{t('billing.heroSubtitle')}</Text>
        </View>

        <View style={s.benefits}>
          <Benefit icon="robot-happy-outline" text={t('billing.benefitAi')} />
          <Benefit icon="map-marker-path" text={t('billing.benefitRoutes')} />
          <Benefit icon="parking" text={t('billing.benefitParking')} />
          <Benefit icon="shield-check-outline" text={t('billing.benefitCrash')} />
        </View>

        {!configured && (
          <View style={s.setupCard}>
            <Icon name="wrench" size={22} color="#FBBF24" />
            <View style={s.setupTextWrap}>
              <Text style={s.setupTitle}>{t('billing.setupTitle')}</Text>
              <Text style={s.setupText}>{t('billing.setupText')}</Text>
            </View>
          </View>
        )}

        {loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator size="large" color="#00BFFF" />
            <Text style={s.muted}>{t('billing.loading')}</Text>
          </View>
        ) : (
          <View style={s.packages}>
            {packages.length > 0 ? packages.map(pkg => (
              <TouchableOpacity
                key={pkg.identifier}
                style={s.packageCard}
                activeOpacity={0.82}
                disabled={Boolean(busyPackageId)}
                onPress={() => purchase(pkg)}
              >
                <View style={s.packageText}>
                  <Text style={s.packageTitle}>{packageLabel(pkg)}</Text>
                  <Text style={s.packageDesc}>{pkg.product.description || t('billing.packageFallback')}</Text>
                </View>
                <View style={s.priceWrap}>
                  {busyPackageId === pkg.identifier ? (
                    <ActivityIndicator size="small" color="#00F5A0" />
                  ) : (
                    <>
                      <Text style={s.price}>{pkg.product.priceString}</Text>
                      <Text style={s.trial}>{t('billing.trialBadge')}</Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            )) : (
              <View style={s.emptyPackages}>
                <Icon name="store-alert-outline" size={28} color="rgba(255,255,255,0.55)" />
                <Text style={s.emptyTitle}>{t('billing.noPackages')}</Text>
                <Text style={s.emptyText}>{t('billing.noPackagesText')}</Text>
              </View>
            )}
          </View>
        )}

        {error && <Text style={s.error}>{error}</Text>}

        <TouchableOpacity
          style={s.restoreBtn}
          activeOpacity={0.8}
          disabled={restoring}
          onPress={restore}
        >
          {restoring ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name="restore" size={18} color="#fff" />
          )}
          <Text style={s.restoreTxt}>{t('billing.restore')}</Text>
        </TouchableOpacity>

        <Text style={s.finePrint}>{t('billing.finePrint')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const Benefit = ({ icon, text }: { icon: string; text: string }) => (
  <View style={s.benefit}>
    <Icon name={icon} size={21} color="#00F5A0" />
    <Text style={s.benefitText}>{text}</Text>
  </View>
);

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 36 },
  hero: {
    alignItems: 'center',
    padding: 22,
    borderRadius: 26,
    backgroundColor: 'rgba(0,191,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,191,255,0.22)',
  },
  crown: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,209,102,0.12)',
    marginBottom: 14,
  },
  title: { color: '#fff', fontSize: 25, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  subtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  benefits: { gap: 10, marginTop: 18 },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  benefitText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  setupCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.42)',
    backgroundColor: 'rgba(251,191,36,0.08)',
    marginTop: 18,
  },
  setupTextWrap: { flex: 1 },
  setupTitle: { color: '#FBBF24', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  setupText: { color: 'rgba(255,255,255,0.74)', fontSize: 13, lineHeight: 18 },
  loadingBox: { alignItems: 'center', padding: 28, gap: 10 },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  packages: { marginTop: 18, gap: 12 },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  packageText: { flex: 1 },
  packageTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 4 },
  packageDesc: { color: 'rgba(255,255,255,0.62)', fontSize: 12, lineHeight: 16 },
  priceWrap: { alignItems: 'flex-end', minWidth: 92 },
  price: { color: '#00F5A0', fontSize: 18, fontWeight: '900' },
  trial: { color: '#FFD166', fontSize: 11, fontWeight: '800', marginTop: 3 },
  emptyPackages: {
    alignItems: 'center',
    gap: 8,
    padding: 22,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  emptyText: { color: 'rgba(255,255,255,0.62)', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  error: {
    color: '#FF8A8A',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
    textAlign: 'center',
  },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  restoreTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  finePrint: { color: 'rgba(255,255,255,0.42)', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 18 },
});

export default PaywallScreen;
