/**
 * EU Regulation (EC) 561/2006 — Hours of Service (HOS) limits.
 *
 * Single source of truth for every driving / break / rest threshold used across
 * the navigation and tacho features. Do NOT redefine these values locally —
 * import from here so the regulation lives in exactly one place.
 *
 * Seconds (`_S`) and minutes (`_MIN`) forms are both provided because the BLE
 * tacho path works in minutes while the navigation/route math works in seconds.
 */

// ── Continuous driving ─────────────────────────────────────────────────────────
/** Max continuous driving before a break is required: 4.5 h. */
export const HOS_CONTINUOUS_DRIVE_LIMIT_S = 16_200;
export const HOS_CONTINUOUS_DRIVE_LIMIT_MIN = 270;

/** UI warning offsets before the 4.5 h continuous limit. */
export const HOS_CONTINUOUS_WARN_30MIN_S = HOS_CONTINUOUS_DRIVE_LIMIT_S - 30 * 60; // 14 400 (4 h)
export const HOS_CONTINUOUS_WARN_10MIN_S = HOS_CONTINUOUS_DRIVE_LIMIT_S - 10 * 60; // 15 600
/** Warning starts 30 min before the limit (4 h driven). */
export const HOS_CONTINUOUS_WARN_MIN = HOS_CONTINUOUS_DRIVE_LIMIT_MIN - 30; // 240

// ── Breaks ─────────────────────────────────────────────────────────────────────
/** Full break that resets the continuous-driving counter: 45 min. */
export const HOS_BREAK_FULL_S = 2_700;
export const HOS_BREAK_FULL_MIN = 45;
/** Split break: 15 min (first part) + 30 min (second part). */
export const HOS_BREAK_SPLIT_FIRST_S = 900;
export const HOS_BREAK_SPLIT_FIRST_MIN = 15;
export const HOS_BREAK_SPLIT_SECOND_S = 1_800;
export const HOS_BREAK_SPLIT_SECOND_MIN = 30;

// ── Daily driving ──────────────────────────────────────────────────────────────
/** Standard daily driving limit: 9 h. */
export const HOS_DAILY_DRIVE_LIMIT_S = 32_400;
/** Extended daily limit (allowed at most twice per week): 10 h. */
export const HOS_DAILY_DRIVE_EXTENDED_S = 36_000;

// ── Weekly / fortnightly driving ─────────────────────────────────────────────────
/** Weekly driving limit: 56 h. */
export const HOS_WEEKLY_DRIVE_LIMIT_S = 201_600;
/** Warning offset: 2 h before the 56 h weekly limit (54 h). */
export const HOS_WEEKLY_WARN_S = HOS_WEEKLY_DRIVE_LIMIT_S - 2 * 60 * 60; // 194 400
/** Fortnightly (two-week) driving limit: 90 h. */
export const HOS_BIWEEKLY_DRIVE_LIMIT_S = 324_000;
