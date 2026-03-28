import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * RecuperationPanel (Prototype Design)
 * Displays active compensation debts and deadlines.
 */
export const RecuperationPanel = ({ debtHours, weeksLeft, statusColor }: any) => {
  return (
    <View style={styles.container}>
      <View style={[styles.glow, { shadowColor: statusColor }]} />
      
      <View style={styles.header}>
        <Text style={styles.title}>⏳ РЕКУПЕРАЦИЯ (ДЪЛГ)</Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      <View style={styles.content}>
        <View style={styles.debtCircle}>
          <Text style={[styles.hours, { color: statusColor }]}>{debtHours}ч</Text>
          <Text style={styles.label}>ЗА ВРЪЩАНЕ</Text>
        </View>

        <View style={styles.details}>
          <Text style={styles.deadlineTxt}>Краен срок:</Text>
          <Text style={[styles.weekValue, { color: statusColor }]}>
            Края на Седмица {weeksLeft}
          </Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: '60%', backgroundColor: statusColor }]} />
          </View>
          <Text style={styles.hint}>*Трябва да се добави към 9ч+ почивка</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(10, 15, 35, 0.9)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    width: 300,
    margin: 20,
  },
  glow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    zIndex: -1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  debtCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 40,
    width: 80,
    height: 80,
  },
  hours: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  label: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 8,
    fontWeight: '700',
  },
  details: {
    flex: 1,
  },
  deadlineTxt: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
  },
  weekValue: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  hint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 8,
    fontStyle: 'italic',
  }
});
