import { z } from 'zod';

export const FuelTypeEnum = z.enum(['diesel', 'lpg', 'electric', 'hybrid', 'cng']);
export type FuelType = z.infer<typeof FuelTypeEnum>;

export const HazmatClassEnum = z.enum([
  'none',
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);
export type HazmatClass = z.infer<typeof HazmatClassEnum>;

export const VehicleProfileSchema = z.object({
  name: z.string().min(1, 'Моля въведете наименование'),
  plate: z.string().min(2, 'Невалиден регистрационен номер'),
  height_m: z
    .number()
    .min(0.5, 'Минимум 0.5 м')
    .max(5.0, 'Максимум 5.0 м'),
  weight_t: z
    .number()
    .min(0.5, 'Минимум 0.5 т')
    .max(60, 'Максимум 60 т'),
  width_m: z
    .number()
    .min(0.5, 'Минимум 0.5 м')
    .max(3.0, 'Максимум 3.0 м'),
  length_m: z
    .number()
    .min(1, 'Минимум 1 м')
    .max(25, 'Максимум 25 м'),
  axle_count: z
    .number()
    .int('Въведете цяло число')
    .min(2, 'Минимум 2 оси')
    .max(9, 'Максимум 9 оси'),
  fuel_type: FuelTypeEnum,
  hazmat_class: HazmatClassEnum.default('none'),
});

export type VehicleProfile = z.infer<typeof VehicleProfileSchema>;

export const DEFAULT_VEHICLE_PROFILE: VehicleProfile = {
  name: 'Моят камион',
  plate: '',
  height_m: 4.0,
  weight_t: 18,
  width_m: 2.55,
  length_m: 12,
  axle_count: 3,
  fuel_type: 'diesel',
  hazmat_class: 'none',
};
