$env:Path += ";C:\Users\breik\AppData\Local\Android\Sdk\platform-tools"
adb -s RFCX504DVWV shell am start -n "com.truckai.pro/.MainActivity"
Start-Sleep -Seconds 4
adb -s RFCX504DVWV shell screencap -p /sdcard/screen_app.png
adb -s RFCX504DVWV pull /sdcard/screen_app.png "C:\Users\breik\TruckExpoAI\screen_app.png"
Write-Host "Done"
