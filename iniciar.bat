@echo off
title DeepSeek OCR Studio
echo ===================================================
echo       Iniciando DeepSeek OCR Studio para PDF
echo ===================================================
echo.

:: Verificar si Node.js esta instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no fue encontrado en el PATH.
    pause
    exit /b 1
)

:: Iniciar el navegador despues de 2 segundos en segundo plano
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

:: Iniciar servidor
echo Servidor ejecutandose en http://localhost:3000
echo Presiona Ctrl+C para detener el servidor.
echo.
node server.js
pause
