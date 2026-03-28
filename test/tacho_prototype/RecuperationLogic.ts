/**
 * RecuperationLogic - EU 561/2006 Compensation Tracker
 * 
 * Rules:
 * 1. If Weekly Rest < 45h (min 24h), the difference must be compensated.
 * 2. Compensation must be taken en bloc (all at once).
 * 3. Deadline: End of the 3rd week following the week of reduction.
 * 4. Must be attached to another rest period of at least 9h.
 */

export interface CompensationDebt {
  hours: number;          // Total hours to return (e.g., 21)
  originWeek: number;     // ISO week number where reduction happened
  deadlineWeek: number;   // Week when debt expires (origin + 3)
  isCritical: boolean;    // True if we are in the 3rd week
}

export const RecuperationLogic = {
  calculateDebt: (restHours: number, currentWeek: number): CompensationDebt | null => {
    if (restHours >= 45) return null;
    
    const debtHours = 45 - restHours;
    return {
      hours: debtHours,
      originWeek: currentWeek,
      deadlineWeek: currentWeek + 3,
      isCritical: false // Will be updated by real-time check
    };
  },

  getStatusColor: (debt: CompensationDebt, currentWeek: number) => {
    const weeksLeft = debt.deadlineWeek - currentWeek;
    if (weeksLeft <= 1) return '#FF3B30'; // Red - Must return NOW
    if (weeksLeft <= 2) return '#FF9500'; // Orange - Plan for next week
    return '#00BFFF'; // Blue - Safe
  }
};
