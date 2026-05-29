#requires -Version 5.1
# Generates media/icon.png (256x256) for the Polyvoice extension.
# Run from repo root:  pwsh -File scripts/make-icon.ps1

Add-Type -AssemblyName System.Drawing

$size      = 256
$out       = Join-Path $PSScriptRoot '..\media\icon.png'
$out       = [System.IO.Path]::GetFullPath($out)
$radius    = 56

$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRectPath {
    param([float]$x, [float]$y, [float]$w, [float]$h, [float]$r)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x,           $y,           $d, $d, 180, 90) | Out-Null
    $path.AddArc($x + $w - $d, $y,           $d, $d, 270, 90) | Out-Null
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d,   0, 90) | Out-Null
    $path.AddArc($x,           $y + $h - $d, $d, $d,  90, 90) | Out-Null
    $path.CloseFigure()
    return $path
}

# --- Background: rounded square with diagonal gradient ---------------------
$bgRect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
$bgPath = New-RoundedRectPath 0 0 $size $size $radius

$gradStart = [System.Drawing.Color]::FromArgb(255, 31, 17, 71)     # deep indigo #1f1147
$gradEnd   = [System.Drawing.Color]::FromArgb(255, 236, 72, 153)   # hot pink #ec4899
$gradMid   = [System.Drawing.Color]::FromArgb(255, 124, 58, 237)   # violet #7c3aed

$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect, $gradStart, $gradEnd,
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)

$blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
$blend.Colors    = @($gradStart, $gradMid, $gradEnd)
$blend.Positions = @([float]0.0, [float]0.55, [float]1.0)
$bgBrush.InterpolationColors = $blend

$g.FillPath($bgBrush, $bgPath)

# --- Subtle inner highlight (top-left bloom) -------------------------------
$bloomRect = New-Object System.Drawing.RectangleF -40, -40, 220, 220
$bloomPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$bloomPath.AddEllipse($bloomRect) | Out-Null
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $bloomPath
$pgb.CenterColor   = [System.Drawing.Color]::FromArgb(90, 255, 255, 255)
$pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
$saved = $g.Save()
$g.SetClip($bgPath)
$g.FillPath($pgb, $bloomPath)
$g.Restore($saved)
$pgb.Dispose(); $bloomPath.Dispose()

# --- Play triangle (left of center) ----------------------------------------
# Equilateral-ish triangle pointing right
$triCx = 92.0
$triCy = 128.0
$triH  = 96.0   # height
$triW  = 84.0   # base->tip distance
$tri = @(
    (New-Object System.Drawing.PointF ($triCx - $triW/2),         ($triCy - $triH/2)),
    (New-Object System.Drawing.PointF ($triCx - $triW/2),         ($triCy + $triH/2)),
    (New-Object System.Drawing.PointF ($triCx + $triW/2 + 6.0),    $triCy)
)
$triPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$triPath.AddPolygon([System.Drawing.PointF[]]$tri) | Out-Null

# Soft shadow behind triangle
$shadowOffset = 3
$shadowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$shadowPath.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF ($tri[0].X + $shadowOffset), ($tri[0].Y + $shadowOffset)),
    (New-Object System.Drawing.PointF ($tri[1].X + $shadowOffset), ($tri[1].Y + $shadowOffset)),
    (New-Object System.Drawing.PointF ($tri[2].X + $shadowOffset), ($tri[2].Y + $shadowOffset))
)) | Out-Null
$shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
$g.FillPath($shadowBrush, $shadowPath)
$shadowBrush.Dispose(); $shadowPath.Dispose()

$triBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.FillPath($triBrush, $triPath)
$triBrush.Dispose(); $triPath.Dispose()

# --- Sound-wave arcs (radiating right) -------------------------------------
# Three nested arcs on the right side, decreasing opacity outward
$arcCx = 132.0
$arcCy = 128.0
$arcStart = -55.0   # degrees
$arcSweep = 110.0

$waves = @(
    @{ Radius = 38.0; Width = 12.0; Alpha = 255 },
    @{ Radius = 64.0; Width = 12.0; Alpha = 200 },
    @{ Radius = 90.0; Width = 12.0; Alpha = 130 }
)

foreach ($w in $waves) {
    $r = [float]$w.Radius
    $rect = New-Object System.Drawing.RectangleF ($arcCx - $r), ($arcCy - $r), ($r*2), ($r*2)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($w.Alpha, 255, 255, 255)), ([float]$w.Width)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($pen, $rect, $arcStart, $arcSweep)
    $pen.Dispose()
}

# --- Save ------------------------------------------------------------------
$bgBrush.Dispose()
$bgPath.Dispose()
$g.Dispose()

if (Test-Path $out) {
    $bak = "$out.bak"
    if (-not (Test-Path $bak)) { Copy-Item $out $bak }
}
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "Wrote $out ($size x $size)"
