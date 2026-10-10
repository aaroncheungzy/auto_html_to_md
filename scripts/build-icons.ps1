# Rasterize the geometric logo for Chromium manifest icon sizes.
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '..\icons'
foreach ($size in @(16, 48, 128)) {
    $bitmap = [System.Drawing.Bitmap]::new($size * 4, $size * 4)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(($size * 4 / 48), ($size * 4 / 48))
    $background = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $background.AddArc(0, 0, 24, 24, 180, 90)
    $background.AddArc(24, 0, 24, 24, 270, 90)
    $background.AddArc(24, 24, 24, 24, 0, 90)
    $background.AddArc(0, 24, 24, 24, 90, 90)
    $background.CloseFigure()
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#2563eb'))
    $graphics.FillPath($brush, $background)
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 2)
    $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $shapes = @(
        @(14,12, 28,12, 34,18, 34,36, 14,36, 14,12),
        @(28,12, 28,18, 34,18),
        @(19,29, 19,22, 23,26, 27,22, 27,29),
        @(31,25, 31,31),
        @(29,29, 31,31, 33,29)
    )
    foreach ($shape in $shapes) {
        for ($i = 0; $i -lt $shape.Count - 2; $i += 2) {
            $graphics.DrawLine($pen, [single]$shape[$i], [single]$shape[$i+1], [single]$shape[$i+2], [single]$shape[$i+3])
        }
    }
    $resized = [System.Drawing.Bitmap]::new($size, $size)
    $output = [System.Drawing.Graphics]::FromImage($resized)
    $output.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $output.DrawImage($bitmap, 0, 0, $size, $size)
    $resized.Save((Join-Path $iconDirectory "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $output.Dispose(); $resized.Dispose(); $pen.Dispose(); $brush.Dispose()
    $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
