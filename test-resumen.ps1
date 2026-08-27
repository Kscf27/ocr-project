$body = @{
    model = "deepseek-ocr:latest"
    prompt = "Resume en 2 lineas este texto: Factura de prueba por $100"
    stream = $false
} | ConvertTo-Json

$res = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
$res.response
