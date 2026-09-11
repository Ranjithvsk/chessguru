@echo off
REM Start the book host if it is not already listening.
REM
REM The main task triggers AT LOGON, so a reboot leaves ingest stopped until
REM someone signs in - and a multi-day run would pause silently, with the shelf
REM simply not growing. This runs AT STARTUP and is a no-op when the host is
REM already up, so it can never produce a second copy fighting for the queue.
netstat -ano | findstr ":8791" | findstr LISTENING >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [%DATE% %TIME%] already listening, nothing to do >> E:\dreamocr\bookhost-boot.log
  exit /b 0
)
echo [%DATE% %TIME%] not listening - starting book host >> E:\dreamocr\bookhost-boot.log
start "" /B E:\ocr-gpu\Scripts\python.exe E:\dreamocr\bookhost.py >> E:\dreamocr\bookhost-boot.log 2>&1
