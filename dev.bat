@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   AI Code Agent - Build and Install
echo ========================================
echo.

cd /d "%~dp0vscode-extension"

echo [1/4] Checking dependencies...
if not exist node_modules (
    echo    Installing npm packages...
    call npm install
    if errorlevel 1 (
        echo    npm install FAILED!
        pause
        exit /b 1
    )
)

echo [2/4] Compiling TypeScript...
call npm run compile 2>&1
if errorlevel 1 (
    echo.
    echo ============================================
    echo   COMPILE FAILED! Check errors above.
    echo ============================================
    pause
    exit /b 1
)
echo    Compile OK.

echo [3/4] Packaging VSIX...
call npx vsce package --no-dependencies --allow-missing-repository 2>nul
if errorlevel 1 (
    echo    vsce not found, installing...
    call npm install -g @vscode/vsce
    call npx vsce package --no-dependencies --allow-missing-repository
    if errorlevel 1 (
        echo    Package FAILED!
        pause
        exit /b 1
    )
)
echo    Package OK.

echo [4/4] Installing to VS Code...
set INSTALLED=0
for %%f in (*.vsix) do (
    echo    Installing %%f ...
    code --install-extension "%%f" --force
    if errorlevel 1 (
        echo    Install FAILED for %%f
    ) else (
        echo    Install OK: %%f
        set INSTALLED=1
    )
    del "%%f"
)

if "%INSTALLED%"=="0" (
    echo.
    echo    WARNING: No .vsix file found to install!
    echo    Check if packaging step succeeded.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Done! Now in VS Code:
echo   Ctrl+Shift+P -^> Reload Window
echo ========================================
echo.
pause
