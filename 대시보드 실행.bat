@echo off
chcp 65001 >nul
cd /d "%~dp0"
curl -s -o nul http://localhost:3000/
if not errorlevel 1 goto open
echo 네이버 자동글쓰기 대시보드를 켜는 중...
start "네이버 대시보드 서버 (이 창을 닫으면 대시보드가 꺼집니다)" /min node dashboard\server.js
timeout /t 4 /nobreak >nul
:open
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:3000/
) else (
  start "" http://localhost:3000/
)
