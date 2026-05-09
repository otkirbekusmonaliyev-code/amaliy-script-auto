@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo.
echo  ============================================
echo    LMS Auth Tester — Task Scheduler Setup
echo  ============================================
echo.

:: ─── Sozlamalar ──────────────────────────────────────────────────────────────
:: Bu yerda o'zgartiring:
set "SCRIPT_DIR=%~dp0"
set "TASK_NAME=LMS_Auth_Tester_Hourly"
set "NODE_EXE=node"
set "SCRIPT_FILE=%SCRIPT_DIR%lms_tester.js"
set "LOG_FILE=%SCRIPT_DIR%scheduler.log"

:: Telegram sozlamalari
set /p "TG_BOT_TOKEN=TG_BOT_TOKEN kiriting (yoki Enter — keyinroq .env orqali): "
set /p "TG_CHAT_ID=TG_CHAT_ID kiriting (yoki Enter — keyinroq .env orqali):   "

echo.
echo  [*] Node.js tekshirilmoqda...
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  [x] Node.js topilmadi! https://nodejs.org dan yuklab o'rnating.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [+] Node.js topildi: %NODE_VER%

:: ─── .env fayl yaratish ───────────────────────────────────────────────────────
if not "%TG_BOT_TOKEN%"=="" (
  echo TG_BOT_TOKEN=%TG_BOT_TOKEN%>"%SCRIPT_DIR%.env"
  echo TG_CHAT_ID=%TG_CHAT_ID%>>"%SCRIPT_DIR%.env"
  echo  [+] .env fayli yaratildi
) else (
  echo  [!] TG sozlamalari kiritilmadi — .env faylini qo'lda to'ldiring
)

:: ─── run_lms.bat yaratish (Task Scheduler shu faylni chaqiradi) ───────────────
set "RUNNER=%SCRIPT_DIR%run_lms.bat"
(
  echo @echo off
  echo cd /d "%SCRIPT_DIR%"
  echo set "TG_BOT_TOKEN=%TG_BOT_TOKEN%"
  echo set "TG_CHAT_ID=%TG_CHAT_ID%"
  echo node "%SCRIPT_FILE%" >> "%LOG_FILE%" 2^>^&1
) > "%RUNNER%"
echo  [+] run_lms.bat yaratildi: %RUNNER%

:: ─── Task Scheduler ro'yxatdan o'chirish (eski bo'lsa) ───────────────────────
schtasks /query /tn "%TASK_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
  echo  [!] Eski task o'chirilmoqda...
  schtasks /delete /tn "%TASK_NAME%" /f >nul
)

:: ─── Yangi task yaratish — har soatda ────────────────────────────────────────
echo  [*] Task Scheduler vazifasi yaratilmoqda...

schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "\"%RUNNER%\"" ^
  /sc HOURLY ^
  /mo 1 ^
  /st 00:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f >nul

if %errorlevel% equ 0 (
  echo  [+] Task muvaffaqiyatli yaratildi!
  echo.
  echo  Task nomi  : %TASK_NAME%
  echo  Chaqiruv   : Har soatda 1 marta
  echo  Script     : %SCRIPT_FILE%
  echo  Log fayl   : %LOG_FILE%
) else (
  echo  [x] Task yaratishda xatolik! Administrator sifatida ishlatib ko'ring.
  pause
  exit /b 1
)

:: ─── Darhol test qilish ───────────────────────────────────────────────────────
echo.
set /p "RUN_NOW=Hozir bir marta test qilib ko'rasizmi? (Y/N): "
if /i "%RUN_NOW%"=="Y" (
  echo.
  echo  [*] Test ishga tushirilmoqda...
  echo.
  cd /d "%SCRIPT_DIR%"
  if not "%TG_BOT_TOKEN%"=="" set "TG_BOT_TOKEN=%TG_BOT_TOKEN%"
  if not "%TG_CHAT_ID%"=="" set "TG_CHAT_ID=%TG_CHAT_ID%"
  node "%SCRIPT_FILE%"
)

echo.
echo  ============================================
echo   Sozlash tugadi! Foydali buyruqlar:
echo.
echo   Tekshirish:
echo     schtasks /query /tn "%TASK_NAME%"
echo.
echo   Qo'lda ishlatish:
echo     schtasks /run /tn "%TASK_NAME%"
echo.
echo   O'chirish:
echo     schtasks /delete /tn "%TASK_NAME%" /f
echo.
echo   Log ko'rish:
echo     type "%LOG_FILE%"
echo  ============================================
echo.
pause