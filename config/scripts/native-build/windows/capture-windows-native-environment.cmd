@echo off
chcp 65001 >nul
call "%TOPO_WINDOWS_VSDEVCMD%" -no_logo -arch=%TOPO_WINDOWS_NATIVE_ARCH% -host_arch=%TOPO_WINDOWS_NATIVE_ARCH%
if errorlevel 1 exit /b 1
echo TOPO_WINDOWS_NATIVE_ENVIRONMENT
set
