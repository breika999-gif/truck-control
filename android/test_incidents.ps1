$token = 'pk.eyJ1IjoiYnJlaWthOTk5IiwiYSI6ImNtbHBob2xjMzE5Z3MzZ3F4Y3QybGpod3AifQ.hprmbhb8EVFSfF7cqc4lkw'
$bbox = '26.58,42.92,27.28,43.62'

$urls = @(
  "https://api.mapbox.com/incidents/v1/${bbox}?access_token=${token}",
  "https://api.mapbox.com/incidents/v1?bbox=${bbox}&access_token=${token}",
  "https://api.mapbox.com/navigation/v1/incidents?bbox=${bbox}&access_token=${token}",
  "https://api.mapbox.com/traffic/v1/incidents?bbox=${bbox}&access_token=${token}"
)

foreach ($url in $urls) {
  $short = $url.Split('?')[0]
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 6
    Write-Host "OK $($r.StatusCode): $short"
    Write-Host $r.Content.Substring(0, [Math]::Min(300, $r.Content.Length))
  } catch {
    $msg = $_.Exception.Message -replace "`n"," "
    Write-Host "FAIL: $short -> $($msg.Substring(0, [Math]::Min(120,$msg.Length)))"
  }
}
