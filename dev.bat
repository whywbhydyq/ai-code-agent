@echo off
echo ========================================
echo   AI Code Agent - 快速编译 + 安装
echo ========================================
echo.

cd /d "%~dp0vscode-extension"

echo [1/3] 编译 TypeScript...
call npm run compile
if errorlevel 1 (
    echo 编译失败！
    pause
    exit /b 1
)

echo [2/3] 打包 VSIX...
call npx vsce package --no-dependencies 2>nul
if errorlevel 1 (
    echo 打包失败，尝试安装 vsce...
    call npm install -g @vscode/vsce
    call npx vsce package --no-dependencies
)

echo [3/3] 安装到 VS Code...
for %%f in (*.vsix) do (
    echo 安装 %%f ...
    code --install-extension "%%f" --force
    del "%%f"
)

echo.
echo ✅ 完成！请在 VS Code 中按 Ctrl+Shift+P 输入 Reload Window
echo.
pause
