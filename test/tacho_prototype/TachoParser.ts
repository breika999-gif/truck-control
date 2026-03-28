/**
 * TachoParser - Translating HEX to Driver Activity & Time
 * Activity Codes: 0=REST, 1=AVAILABILITY, 2=WORK, 3=DRIVING
 */

export const TachoParser = {
  // Parsing activity code
  parseActivity: (hex: string): string => {
    const code = parseInt(hex, 16);
    switch (code) {
      case 0: return 'Почивка 😴';
      case 1: return 'На разположение ⏸';
      case 2: return 'Друга работа 🛠';
      case 3: return 'Шофиране 🚛';
      default: return 'Неизвестно ❓';
    }
  },

  // Parsing remaining time (sent in minutes/seconds hex)
  parseTime: (hex: string): number => {
    return parseInt(hex, 16); // In minutes
  },

  // Formatting for Gemini (Live Context)
  formatForGemini: (activity: string, timeRemaining: number) => {
    return {
      tacho_live_context: {
        current_activity: activity,
        driving_time_left_min: timeRemaining,
        timestamp: new Date().toISOString()
      }
    };
  }
};
