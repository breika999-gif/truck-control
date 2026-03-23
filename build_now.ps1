$env:Path += ";C:\Users\breik\AppData\Local\Android\Sdk\platform-tools"
Set-Location "C:\Users\breik\TruckExpoAI\android"
& ".\gradlew.bat" app:installDebug -x lint -PreactNativeDevServerPort=8081
