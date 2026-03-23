@echo off
echo ========================================
echo   AI Code Agent - Build and Install
echo ========================================
echo.

cd /d "%~dp0vscode-extension"

echo [1/3] Compiling TypeScript...
call npm run compile
if errorlevel 1 (
    echo Compile FAILED!
    pause
    exit /b 1
)

echo [2/3] Packaging VSIX...
call npx vsce package --no-dependencies 2>nul
if errorlevel 1 (
    echo Installing vsce...
    call npm install -g @vscode/vsce
    call npx vsce package --no-dependencies
)

echo [3/3] Installing to VS Code...
for %%f in (*.vsix) do (
    echo Installing %%f ...
    code --install-extension "%%f" --force
    del "%%f"
)

echo.
echo Done! Press Ctrl+Shift+P in VS Code, type Reload Window
echo.
pause
