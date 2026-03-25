@echo off
setlocal
cd /d "%~dp0"

echo ======================================================
echo           JEJU ISLAND : VIRTUAL ODYSSEY v3.4
echo ======================================================
echo.
echo [1] 로컬 서버를 가동 중입니다... (GPS 연동 환경 구축)
echo [2] 브라우저 창이 자동으로 열립니다. (주소: http://localhost:8080)
echo.

:: 브라우저를 강제로 전면에 띄우기 위해 시작 명령 사용
start "" "http://localhost:8080/world_jeju_gps.html"

:: 서버 실행 (npx 설치 확인 시 y 입력 필요)
npx -y http-server . -p 8080

pause
