$env:Path += ";C:\Users\breik\AppData\Local\Android\Sdk\platform-tools"

# Clear logcat
& adb -s RFCX504DVWV logcat -c
Start-Sleep -Seconds 1

# Take a screenshot NOW (before nav)
& adb -s RFCX504DVWV shell screencap -p /sdcard/screen_before.png
& adb -s RFCX504DVWV pull /sdcard/screen_before.png "C:\Users\breik\TruckExpoAI\screen_before.png" 2>&1

Write-Host "Screenshot saved." -ForegroundColor Green

# Check live logcat for 15 seconds
Write-Host "=== Live logcat (15s) — watch for lane/Animated events ===" -ForegroundColor Cyan
$timeout = [DateTime]::Now.AddSeconds(15)
& adb -s RFCX504DVWV logcat *:V 2>&1 | ForEach-Object {
    if ([DateTime]::Now -gt $timeout) { break }
    if ($_ -match "lane|Lane|Animated|laneGlow|distToTurn|currentStep|bannerInstr|ReactNativeJS") {
        Write-Host $_ -ForegroundColor Yellow
    }
}

Write-Host "=== Done ===" -ForegroundColor Green
