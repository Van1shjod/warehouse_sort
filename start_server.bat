@echo off
chcp 65001 >nul
title Warehouse System Server

echo ============================================
echo    Warehouse System Server
echo ============================================
echo.
echo Запуск Flask сервера та Cloudflare тунелю...
echo.

cd /d "%~dp0"

REM Запуск Flask сервера у фоновому режимі
start /min cmd /c "python app.py"

REM Чекаємо 3 секунди для запуску Flask
timeout /t 3 /nobreak >nul

REM Запуск Cloudflare тунелю
echo Запуск Cloudflare тунелю...
echo.
echo ============================================
echo Після запуску тунелю ви побачите URL вашого сайту
echo ============================================
echo.
.\cloudflared.exe tunnel --url http://localhost:5000