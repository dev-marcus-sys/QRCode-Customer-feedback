$ErrorActionPreference = "Stop"
$src = "c:\Users\606610\CodeBuddy\QRCode 客戶意見反饋\docs\系統簡介.pptx"
$outDir = "c:\Users\606610\CodeBuddy\QRCode 客戶意見反饋\.build_pptx"
$pp = New-Object -ComObject PowerPoint.Application
try {
  $pres = $pp.Presentations.Open($src, $true, $false, $false)
  foreach ($s in $pres.Slides) {
    $s.Export("$outDir\slide-$($s.SlideIndex).png", "PNG", 1600, 900)
  }
  $pres.Close()
  Write-Output "exported"
} finally {
  $pp.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($pp) | Out-Null
}
