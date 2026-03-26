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

const FUEL_OPTIONS: { label: string; value: FuelType }[] = [
  { label: 'Р вЂќР С‘Р В·Р ВµР В»', value: 'diesel' },
  { label: 'LPG', value: 'lpg' },
  { label: 'Р вЂўР В»Р ВµР С”РЎвЂљРЎР‚Р С‘РЎвЂЎР ВµРЎРѓР С”Р С‘', value: 'electric' },
  { label: 'Р ТђР С‘Р В±РЎР‚Р С‘Р Т‘', value: 'hybrid' },
  { label: 'CNG', value: 'cng' },
];

const HAZMAT_OPTIONS: { label: string; value: HazmatClass }[] = [
  { label: 'Р вЂР ВµР В· ADR', value: 'none' },
  { label: 'Р С™Р В»Р В°РЎРѓ 1 РІР‚вЂќ Р вЂ™Р В·РЎР‚Р С‘Р Р†Р Р…Р С‘', value: '1' },
  { label: 'Р С™Р В»Р В°РЎРѓ 2 РІР‚вЂќ Р вЂњР В°Р В·Р С•Р Р†Р Вµ', value: '2' },
  { label: 'Р С™Р В»Р В°РЎРѓ 3 РІР‚вЂќ Р вЂ”Р В°Р С—Р В°Р В»Р С‘Р СР С‘ РЎвЂљР ВµРЎвЂЎР Р…Р С•РЎРѓРЎвЂљР С‘', value: '3' },
  { label: 'Р С™Р В»Р В°РЎРѓ 4 РІР‚вЂќ Р вЂ”Р В°Р С—Р В°Р В»Р С‘Р СР С‘ РЎвЂљР Р†РЎР‰РЎР‚Р Т‘Р С‘', value: '4' },
  { label: 'Р С™Р В»Р В°РЎРѓ 5 РІР‚вЂќ Р С›Р С”РЎРѓР С‘Р Т‘Р В°Р Р…РЎвЂљР С‘', value: '5' },
  { label: 'Р С™Р В»Р В°РЎРѓ 6 РІР‚вЂќ Р СћР С•Р С”РЎРѓР С‘РЎвЂЎР Р…Р С‘', value: '6' },
  { label: 'Р С™Р В»Р В°РЎРѓ 7 РІР‚вЂќ Р В Р В°Р Т‘Р С‘Р С•Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С‘', value: '7' },
  { label: 'Р С™Р В»Р В°РЎРѓ 8 РІР‚вЂќ Р С™Р С•РЎР‚Р С•Р В·Р С‘Р Р†Р Р…Р С‘', value: '8' },
  { label: 'Р С™Р В»Р В°РЎРѓ 9 РІР‚вЂќ Р В Р В°Р В·Р Р…Р С‘', value: '9' },
];

const ADR_TUNNEL_OPTIONS: { label: string; value: AdrTunnelCode }[] = [
  { label: 'РќСЏРјР°', value: 'none' },
  { label: 'B', value: 'B' },
  { label: 'C', value: 'C' },
  { label: 'D', value: 'D' },
  { label: 'E', value: 'E' },
];

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
  const navigation = useNavigation();
  const { profile, setProfile } = useVehicleStore();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<VehicleProfile>({
    resolver: zodResolver(VehicleProfileSchema) as any, // Zod v4 resolver type mismatch
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
        <Text style={styles.sectionTitle}>Р С›РЎРѓР Р…Р С•Р Р†Р Р…Р С‘ Р Т‘Р В°Р Р…Р Р…Р С‘</Text>

        <FieldLabel label="Р СњР В°Р С‘Р СР ВµР Р…Р С•Р Р†Р В°Р Р…Р С‘Р Вµ" />
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
                placeholder="Р Р…Р В°Р С—РЎР‚. Р вЂ™Р В»Р ВµР С”Р В°РЎвЂЎ Р СљР С’Р Сњ"
                placeholderTextColor={colors.textMuted}
              />
              <ErrorText msg={errors.name?.message} />
            </>
          )}
        />

        <FieldLabel label="Р В Р ВµР С–Р С‘РЎРѓРЎвЂљРЎР‚Р В°РЎвЂ Р С‘Р С•Р Р…Р ВµР Р… Р Р…Р С•Р СР ВµРЎР‚" />
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
                placeholder="Р СљР С’ 1234 Р С’Р вЂ™"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
              />
              <ErrorText msg={errors.plate?.message} />
            </>
          )}
        />

        <Text style={styles.sectionTitle}>Р В Р В°Р В·Р СР ВµРЎР‚Р С‘ Р С‘ Р СР В°РЎРѓР В°</Text>

        <View style={styles.row}>
          <View style={styles.halfField}>
            <FieldLabel label="Р вЂ™Р С‘РЎРѓР С•РЎвЂЎР С‘Р Р…Р В° (Р С)" />
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
            <FieldLabel label="Р РЃР С‘РЎР‚Р С‘Р Р…Р В° (Р С)" />
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
            <FieldLabel label="Р вЂќРЎР‰Р В»Р В¶Р С‘Р Р…Р В° (Р С)" />
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
            <FieldLabel label="Р СћР ВµР С–Р В»Р С• (РЎвЂљ)" />
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

        <FieldLabel label="Р вЂРЎР‚Р С•Р в„– Р С•РЎРѓР С‘" />
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

        <Text style={styles.sectionTitle}>Р СћР С‘Р С— Р С–Р С•РЎР‚Р С‘Р Р†Р С•</Text>
        <Controller
          control={control}
          name="fuel_type"
          render={({ field: { value, onChange } }) => (
            <SegmentedPicker options={FUEL_OPTIONS} value={value} onChange={onChange} />
          )}
        />

        <Text style={styles.sectionTitle}>ADR Р С”Р В»Р В°РЎРѓ (Р С•Р С—РЎвЂ Р С‘Р С•Р Р…Р В°Р В»Р ВµР Р…)</Text>
        <Controller
          control={control}
          name="hazmat_class"
          render={({ field: { value, onChange } }) => (
            <SegmentedPicker
              options={HAZMAT_OPTIONS}
              value={(value ?? 'none') as HazmatClass}
              onChange={onChange}
            />
          )}
        />


        <Text style={styles.sectionTitle}>ADR тунел код</Text>
        <Controller
          control={control}
          name="adr_tunnel"
          render={({ field: { value, onChange } }) => (
            <SegmentedPicker
              options={ADR_TUNNEL_OPTIONS}
              value={(value ?? 'none') as AdrTunnelCode}
              onChange={onChange}
            />
          )}
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSubmit(onSave)}>
          <Text style={styles.saveButtonText}>Р вЂ”Р В°Р С—Р В°Р В·Р С‘ Р С—РЎР‚Р С•РЎвЂћР С‘Р В»Р В°</Text>
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
