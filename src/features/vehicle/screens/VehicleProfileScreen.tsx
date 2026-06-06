import React from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  VehicleProfile,
  VehicleProfileSchema,
  DEFAULT_VEHICLE_PROFILE,
  FuelType,
  HazmatClass,
  AdrTunnelCode,
} from '../../../shared/types/vehicle';
import { useVehicleStore } from '../../../store/vehicleStore';
import { colors, spacing, radius, typography } from '../../../shared/constants/theme';

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.label}>{label}</Text>;
}

function ErrorText({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <Text style={styles.errorText}>{msg}</Text>;
}

function NumberInput({
  value,
  onChange,
  placeholder,
  error,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <>
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        keyboardType="decimal-pad"
        value={value !== undefined ? String(value) : ''}
        onChangeText={(t) => {
          const n = parseFloat(t.replace(',', '.'));
          if (!isNaN(n)) onChange(n);
          else if (t === '' || t === '-') onChange(0);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
      />
      <ErrorText msg={error} />
    </>
  );
}

function SegmentedPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segmentRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.segmentItem, value === opt.value && styles.segmentItemActive]}
          onPress={() => onChange(opt.value)}
        >
          <Text style={[styles.segmentText, value === opt.value && styles.segmentTextActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function VehicleProfileScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { profile, setProfile } = useVehicleStore();
  const fuelOptions = React.useMemo<{ label: string; value: FuelType }[]>(() => [
    { label: t('vehicle.diesel'), value: 'diesel' },
    { label: 'LPG', value: 'lpg' },
    { label: t('vehicle.electric'), value: 'electric' },
    { label: t('vehicle.hybrid'), value: 'hybrid' },
    { label: 'CNG', value: 'cng' },
  ], [t]);
  const hazmatOptions = React.useMemo<{ label: string; value: HazmatClass }[]>(() => [
    { label: t('vehicle.noAdr'), value: 'none' },
    { label: t('vehicle.hazmat1'), value: '1' },
    { label: t('vehicle.hazmat2'), value: '2' },
    { label: t('vehicle.hazmat3'), value: '3' },
    { label: t('vehicle.hazmat4'), value: '4' },
    { label: t('vehicle.hazmat5'), value: '5' },
    { label: t('vehicle.hazmat6'), value: '6' },
    { label: t('vehicle.hazmat7'), value: '7' },
    { label: t('vehicle.hazmat8'), value: '8' },
    { label: t('vehicle.hazmat9'), value: '9' },
  ], [t]);
  const adrTunnelOptions = React.useMemo<{ label: string; value: AdrTunnelCode }[]>(() => [
    { label: t('vehicle.none'), value: 'none' },
    { label: 'B', value: 'B' },
    { label: 'C', value: 'C' },
    { label: 'D', value: 'D' },
    { label: 'E', value: 'E' },
  ], [t]);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<VehicleProfile>({
    resolver: zodResolver(VehicleProfileSchema) as any,
    defaultValues: profile ?? DEFAULT_VEHICLE_PROFILE,
  });

  const onSave = (data: VehicleProfile) => {
    setProfile(data);
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>{t('vehicle.basicData')}</Text>

        <FieldLabel label={t('vehicle.name')} />
        <Controller
          control={control}
          name="name"
          render={({ field: { value, onChange, onBlur } }) => (
            <>
              <TextInput
                style={[styles.input, errors.name ? styles.inputError : null]}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={t('vehicle.namePlaceholder')}
                placeholderTextColor={colors.textMuted}
              />
              <ErrorText msg={errors.name?.message} />
            </>
          )}
        />

        <FieldLabel label={t('vehicle.plate')} />
        <Controller
          control={control}
          name="plate"
          render={({ field: { value, onChange, onBlur } }) => (
            <>
              <TextInput
                style={[styles.input, errors.plate ? styles.inputError : null]}
                value={value}
                onChangeText={(t) => onChange(t.toUpperCase())}
                onBlur={onBlur}
                placeholder={t('vehicle.platePlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
              />
              <ErrorText msg={errors.plate?.message} />
            </>
          )}
        />

        <Text style={styles.sectionTitle}>{t('vehicle.dimensions')}</Text>

        <View style={styles.row}>
          <View style={styles.halfField}>
            <FieldLabel label={t('vehicle.height')} />
            <Controller
              control={control}
              name="height_m"
              render={({ field: { value, onChange } }) => (
                <NumberInput
                  value={value}
                  onChange={onChange}
                  placeholder="4.0"
                  error={errors.height_m?.message}
                />
              )}
            />
          </View>
          <View style={styles.halfField}>
            <FieldLabel label={t('vehicle.width')} />
            <Controller
              control={control}
              name="width_m"
              render={({ field: { value, onChange } }) => (
                <NumberInput
                  value={value}
                  onChange={onChange}
                  placeholder="2.55"
                  error={errors.width_m?.message}
                />
              )}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.halfField}>
            <FieldLabel label={t('vehicle.length')} />
            <Controller
              control={control}
              name="length_m"
              render={({ field: { value, onChange } }) => (
                <NumberInput
                  value={value}
                  onChange={onChange}
                  placeholder="12"
                  error={errors.length_m?.message}
                />
              )}
            />
          </View>
          <View style={styles.halfField}>
            <FieldLabel label={t('vehicle.weight')} />
            <Controller
              control={control}
              name="weight_t"
              render={({ field: { value, onChange } }) => (
                <NumberInput
                  value={value}
                  onChange={onChange}
                  placeholder="18"
                  error={errors.weight_t?.message}
                />
              )}
            />
          </View>
        </View>

        <FieldLabel label={t('vehicle.axles')} />
        <Controller
          control={control}
          name="axle_count"
          render={({ field: { value, onChange } }) => (
            <>
              <TextInput
                style={[styles.input, errors.axle_count ? styles.inputError : null]}
                keyboardType="number-pad"
                value={value !== undefined ? String(value) : ''}
                onChangeText={(t) => {
                  const n = parseInt(t, 10);
                  if (!isNaN(n)) onChange(n);
                }}
                placeholder="3"
                placeholderTextColor={colors.textMuted}
              />
              <ErrorText msg={errors.axle_count?.message} />
            </>
          )}
        />

        <Text style={styles.sectionTitle}>{t('vehicle.fuelType')}</Text>
        <Controller
          control={control}
          name="fuel_type"
          render={({ field: { value, onChange } }) => (
            <SegmentedPicker options={fuelOptions} value={value} onChange={onChange} />
          )}
        />

        <Text style={styles.sectionTitle}>{t('vehicle.adrClass')}</Text>
        <Controller
          control={control}
          name="hazmat_class"
          render={({ field: { value, onChange } }) => (
            <SegmentedPicker
              options={hazmatOptions}
              value={(value ?? 'none') as HazmatClass}
              onChange={onChange}
            />
          )}
        />

        <Text style={styles.sectionTitle}>{t('vehicle.adrTunnel')}</Text>
        <Controller
          control={control}
          name="adr_tunnel"
          render={({ field: { value, onChange } }) => (
            <SegmentedPicker
              options={adrTunnelOptions}
              value={(value ?? 'none') as AdrTunnelCode}
              onChange={onChange}
            />
          )}
        />

        <TouchableOpacity style={styles.saveButton} onPress={handleSubmit(onSave)}>
          <Text style={styles.saveButtonText}>{t('vehicle.save')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.accent,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 16,
    marginBottom: spacing.xs,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  halfField: {
    flex: 1,
  },
  segmentRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  segmentItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    backgroundColor: colors.bgSecondary,
  },
  segmentItemActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  saveButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  saveButtonText: {
    ...typography.h3,
    color: colors.text,
  },
});
