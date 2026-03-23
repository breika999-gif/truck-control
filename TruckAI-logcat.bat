@echo off
title TruckAI Logcat
color 0A

set ADB=C:\Users\breik\AppData\Local\Android\Sdk\platform-tools\adb.exe
set PKG=com.truckai.pro

echo ============================================================
echo  TruckAI Pro ^| Live Logcat
echo  Tip: JS console.log -^> Metro browser http://localhost:8081
echo  Press Ctrl+C to stop
echo ============================================================
echo.

:: ── Device check ────────────────────────────────────────────────────────────
%ADB% devices 2>nul | findstr /C:"device" | findstr /V "List" >nul
if errorlevel 1 (
    color 0C
    echo [ERROR] No device connected^^! Plug in USB cable and try again.
    pause
    exit /b 1
)

:: ── Tunnels ──────────────────────────────────────────────────────────────────
%ADB% reverse tcp:8081 tcp:8081 >nul 2>&1
%ADB% reverse tcp:5050 tcp:5050 >nul 2>&1
echo [OK] Tunnels :8081 Metro  +  :5050 Flask

:: ── App PID ──────────────────────────────────────────────────────────────────
for /f "tokens=1" %%P in ('%ADB% shell pidof %PKG% 2^>nul') do set PID=%%P
if "%PID%"=="" (
    color 0E
    echo [WARN] App not running — launching...
    %ADB% shell am start -n %PKG%/%PKG%.MainActivity >nul 2>&1
    timeout /t 3 /nobreak >nul
    for /f "tokens=1" %%P in ('%ADB% shell pidof %PKG% 2^>nul') do set PID=%%P
)
echo [OK] App PID: %PID%
echo.

%ADB% logcat -c
echo [OK] Streaming (PID=%PID%, Fatal crashes, Mapbox/TTS warnings)...
echo ─────────────────────────────────────────────────────────────
echo.

:: Stream:
::  - все от app PID (Java + native + RN lifecycle)
::  - F/ = Fatal crash от всеки процес
::  - BridgelessReact / ReactHost = RN New Architecture events
::  - Mapbox W+ = map/SDK проблеми
::  - TextToSpeech W+ = TTS грешки
:: Изключваме само очевиден hardware шум от системни процеси

%ADB% logcat -v time 2>nul | findstr /I " %PID% \| F/ \|BridgelessReact\|ReactHost\|Mapbox:W\|Mapbox:E\|TextToSpeech:W\|TextToSpeech:E" | findstr /V /I "sensors-hal TelephonyManager GlobalSettings HeatmapThread SLocation PdnController IMSREGI IMSCR SemInsManager wpa_sslib NearbyMediums SpuKey earchbox Watchdog SGM:GameManager isGamePackage HoneyBoard SAMSUNGWALLET GMR bg_async bg : renderThreadPrepared Android surface is not valid Waiting for new one"
