$xml = [xml](Get-Content 'C:\Users\breik\TruckExpoAI\android\ui4.xml')
$nodes = $xml.SelectNodes('//node[@clickable="true"]')
foreach ($n in $nodes) {
    $b = $n.GetAttribute('bounds')
    $t = $n.GetAttribute('text')
    Write-Host "$b  '$t'"
}
