$env:Path += ";C:\Users\breik\AppData\Local\Android\Sdk\platform-tools"
adb -s RFCX504DVWV shell screencap -p /sdcard/screen_now.png
adb -s RFCX504DVWV pull /sdcard/screen_now.png "C:\Users\breik\TruckExpoAI\screen_now.png"
Write-Host "Done"
