# Gemini Tacho Integration - Architecture Guide

## How it works:
1. **Bluetooth Feed (The Source):**
   `useTachoBluetooth.ts` (React Native) is constantly "listening" to the tachograph over BLE.
   
2. **Translation (The Parser):**
   Raw HEX data (e.g., `03 2A 00`) is converted into structured JSON: 
   `{ "activity": "driving", "rem_driving_min": 42 }`.

3. **Backend Communication (The Bridge):**
   Every time the activity changes (e.g., you start driving or stop for rest), the app sends a POST to `/api/tacho/live_update`.

4. **Gemini AI Awareness (The Brain):**
   The Python backend updates the global `driver_context`. 
   When you ask: *"Колега, колко ми остава?"*, Gemini checks the `tacho_live_context` instead of calculating based on GPS.

## Benefits:
* **Pinpoint Accuracy:** No GPS errors. If the tachograph says "Rest", Gemini knows it's "Rest".
* **Proactive Alerts:** Gemini can say: *"Колега, тахографът показва, че ти остават 15 мин каране. Да търся ли паркинг?"*
* **Automatic Border Crossings:** If the tachograph reports a country code change, the app can automatically update the routing.
