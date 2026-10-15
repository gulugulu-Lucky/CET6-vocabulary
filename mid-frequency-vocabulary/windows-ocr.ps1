param(
    [Parameter(Mandatory = $true)]
    [string]$ImagePath,

    [string]$LanguageTag = 'zh-Hans',

    [switch]$AsJson,

    [string]$OutputPath
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

function Await-WinRt {
    param(
        [Parameter(Mandatory = $true)]$AsyncOperation,
        [Parameter(Mandatory = $true)][Type]$ResultType
    )

    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq 'AsTask' -and
            $_.IsGenericMethodDefinition -and
            $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1

    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($AsyncOperation))
    $task.GetAwaiter().GetResult()
}

$resolvedPath = (Resolve-Path -LiteralPath $ImagePath).Path
$language = [Windows.Globalization.Language]::new($LanguageTag)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) {
    throw "OCR language is unavailable: $LanguageTag"
}

$file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedPath)) ([Windows.Storage.StorageFile])
$stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

if ($AsJson) {
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
        image = $resolvedPath
        language = $LanguageTag
        textAngle = $result.TextAngle
        lines = @($lineData)
    } | ConvertTo-Json -Depth 7
} else {
    $payload = $result.Text
}

if ($OutputPath) {
    $resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolvedOutput)) | Out-Null
    [System.IO.File]::WriteAllText($resolvedOutput, $payload, [System.Text.UTF8Encoding]::new($false))
} else {
    $payload
}
