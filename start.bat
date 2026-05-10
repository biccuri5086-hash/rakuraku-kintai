@echo off
cd /d %~dp0
echo.
echo  ========================================
echo       ラクラク勤怠 - 開発環境起動
echo  ========================================
echo.
echo  Next.js サーバーを起動しています...
echo  http://localhost:3000/ で開きます
echo.
timeout /t 2 /nobreak > nul
start "" "http://localhost:3000/"
start "Claude Code" cmd /k "claude"
npm run dev
pause
