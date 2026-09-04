$body = @{
    model = "deepseek-ocr:latest"
    prompt = "Analiza brevemente esta incapacidad medica: Paciente Juan Perez, 3 dias de incapacidad por lumbalgia CIE-10 M54.5 emitida por Sanitas EPS."
    stream = $false
} | ConvertTo-Json

$res = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
$res.response
