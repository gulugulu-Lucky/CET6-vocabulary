param(
    [Parameter(Mandatory = $true)]
    [string]$InputDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string]$LanguageTag = 'zh-Hans'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime]

$script:AsTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.IsGenericMethodDefinition -and
        $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

function Await-WinRt {
    param(
        [Parameter(Mandatory = $true)]$AsyncOperation,
        [Parameter(Mandatory = $true)][Type]$ResultType
    )

    $task = $script:AsTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($AsyncOperation))
    $task.GetAwaiter().GetResult()
}

$language = [Windows.Globalization.Language]::new($LanguageTag)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) {
    throw "OCR language is unavailable: $LanguageTag"
}

$sourceDir = (Resolve-Path -LiteralPath $InputDirectory).Path
$targetDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
[System.IO.Directory]::CreateDirectory($targetDir) | Out-Null

$images = Get-ChildItem -LiteralPath $sourceDir -File |
    Where-Object { $_.Extension -in '.png', '.jpg', '.jpeg' } |
    Sort-Object Name

$completed = 0
foreach ($image in $images) {
    $outputPath = Join-Path $targetDir ($image.BaseName + '.json')
    if (Test-Path -LiteralPath $outputPath) {
        $completed++
        continue
    }

    $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($image.FullName)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lineData = foreach ($line in $result.Lines) {
        $wordData = foreach ($word in $line.Words) {
            [pscustomobject]@{
                text = $word.Text
                x = [math]::Round($word.BoundingRect.X, 2)
                y = [math]::Round($word.BoundingRect.Y, 2)
                width = [math]::Round($word.BoundingRect.Width, 2)
                height = [math]::Round($word.BoundingRect.Height, 2)
            }
        }

        $minX = ($wordData | Measure-Object -Property x -Minimum).Minimum
        $minY = ($wordData | Measure-Object -Property y -Minimum).Minimum
        $maxX = ($wordData | ForEach-Object { $_.x + $_.width } | Measure-Object -Maximum).Maximum
        $maxY = ($wordData | ForEach-Object { $_.y + $_.height } | Measure-Object -Maximum).Maximum

        [pscustomobject]@{
            text = $line.Text
            x = $minX
            y = $minY
            width = [math]::Round($maxX - $minX, 2)
            height = [math]::Round($maxY - $minY, 2)
            words = @($wordData)
        }
    }

    $payload = [pscustomobject]@{
        image = $image.FullName
        language = $LanguageTag
        textAngle = $result.TextAngle
        lines = @($lineData)
    } | ConvertTo-Json -Depth 7

    [System.IO.File]::WriteAllText($outputPath, $payload, [System.Text.UTF8Encoding]::new($false))
    $stream.Dispose()
    $bitmap.Dispose()

    $completed++
    Write-Progress -Activity 'OCR pages' -Status "$completed / $($images.Count)" -PercentComplete (($completed / $images.Count) * 100)
}

Write-Output "OCR_COMPLETE=$completed"
