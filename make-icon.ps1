# Draws app.ico (structural frame on a blue tile) and adds a Start-menu shortcut to start.bat.
Add-Type -AssemblyName System.Drawing
$root = $PSScriptRoot
$sizes = 16, 24, 32, 48, 64, 256
$pngs = foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $k = $s / 256.0
    # rounded tile
    $r = 56 * $k; $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($s - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($s - $r - 1, $s - $r - 1, $r, $r, 0, 90); $path.AddArc(0, $s - $r - 1, $r, $r, 90, 90)
    $path.CloseFigure()
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new($s, $s)), ([System.Drawing.Color]::FromArgb(30, 90, 200)), ([System.Drawing.Color]::FromArgb(12, 40, 110))
    $g.FillPath($grad, $path)
    # 2-bay, 3-storey frame
    $xs = 56, 128, 200; $ys = 52, 108, 164, 220
    $w = [Math]::Max(1.5, 14 * $k)
    $white = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), $w
    $brace = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 170, 40)), ([Math]::Max(1.2, 10 * $k))
    $g.DrawLine($brace, 56 * $k, 220 * $k, 128 * $k, 164 * $k)
    $g.DrawLine($brace, 128 * $k, 164 * $k, 200 * $k, 108 * $k)
    foreach ($x in $xs) { $g.DrawLine($white, $x * $k, 52 * $k, $x * $k, 220 * $k) }
    foreach ($y in $ys[0..2]) { $g.DrawLine($white, 56 * $k - $w / 2, $y * $k, 200 * $k + $w / 2, $y * $k) }
    # fixed supports
    $g.FillRectangle([System.Drawing.Brushes]::White, 40 * $k, 220 * $k, 176 * $k, [Math]::Max(1, 12 * $k))
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    , $ms.ToArray()
}
# ICO container with PNG-encoded entries
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $out
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $d = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([byte]$d); $bw.Write([byte]$d); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
[System.IO.File]::WriteAllBytes("$root\app.ico", $out.ToArray())

# shortcut runs launch.pyw under pythonw: no console windows
$lnk = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\ETABS Model Creator.lnk"
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = (Get-Command pythonw).Source
$sc.Arguments = "`"$root\launch.pyw`""
$sc.WorkingDirectory = $root
$sc.IconLocation = "$root\app.ico,0"
$sc.Description = 'Start the ETABS bridge and web app'
$sc.Save()
$lnk
