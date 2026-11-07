; ─── Personal Trading Intelligence — Windows installer (NSIS) ────────────────
Unicode true
!include "MUI2.nsh"

!define APPNAME "Personal Trading Intelligence"
!define APPVER  "1.2.0"
!define UNINSTKEY "TradingIntelligence"

Name "${APPNAME} ${APPVER}"
OutFile "PTI-Setup-${APPVER}.exe"
InstallDir "$LOCALAPPDATA\TradingIntelligence"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show

!define MUI_ICON   "app/resources/app/icon.ico"
!define MUI_UNICON "app/resources/app/icon.ico"

!define MUI_WELCOMEPAGE_TEXT "This wizard installs ${APPNAME} — your local, read-only MT5 analytics dashboard.$\r$\n$\r$\nهوش معاملاتی شخصی: داشبورد تحلیل معاملات متاتریدر ۵ — کاملاً محلی و فقط-خواندنی.$\r$\n$\r$\n${APPNAME} v${APPVER}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\TradingIntelligence.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch dashboard now — باز کردن داشبورد"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"

  ; Application payload (Electron shell + server + python + connector + db)
  File /r "app/*"
  File "README-fa.txt"

  ; Publish this very setup executable into the app's download folder so the
  ; dashboard's Settings keeps offering the direct download after install
  ; (the packaged payload strips installer files to avoid self-nesting —
  ;  the running installer is the authoritative copy, hash-consistent with
  ;  the .exe inside the distributed ZIP).
  Delete "$INSTDIR\resources\app\server\public\PTI-Setup-*.exe"
  Delete "$INSTDIR\resources\app\server\public\PTI-Setup-*.zip"
  CopyFiles "$EXEPATH" "$INSTDIR\resources\app\server\public\PTI-Setup-${APPVER}.exe"

  ; Shortcuts
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\TradingIntelligence.exe" "" "$INSTDIR\resources\app\icon.ico"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\TradingIntelligence.exe" "" "$INSTDIR\resources\app\icon.ico"

  ; Uninstaller + Add/Remove Programs registration (per-user)
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "DisplayVersion" "${APPVER}"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "Publisher"      "Personal Trading Intelligence"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "DisplayIcon"    "$INSTDIR\resources\app\icon.ico"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" "NoRepair" 1
  WriteRegStr   HKCU "Software\${UNINSTKEY}" "InstallDir" "$INSTDIR"
SectionEnd

Section "Uninstall"
  ; Keep the user's trading data unless they explicitly say no.
  MessageBox MB_YESNO|MB_ICONQUESTION "Keep your trading data (the db folder)?$\n$\nداده‌های معاملاتی شما (پوشهٔ db) حفظ شود؟" IDYES keepdata

    RMDir /r "$INSTDIR"
    Goto done

  keepdata:
    RMDir /r "$INSTDIR\resources"
    Delete "$INSTDIR\TradingIntelligence.exe"
    Delete "$INSTDIR\README-fa.txt"

  done:
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
    Delete "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk"
    RMDir  "$SMPROGRAMS\${APPNAME}"
    Delete "$DESKTOP\${APPNAME}.lnk"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}"
    DeleteRegKey HKCU "Software\${UNINSTKEY}"
    RMDir "$INSTDIR"
SectionEnd
