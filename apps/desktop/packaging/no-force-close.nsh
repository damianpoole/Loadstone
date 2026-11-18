; A running Loadstone owns SQLite. Never terminate it from an installer or uninstaller.
!macro customCheckAppRunning
  StrCpy $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $2 0
  ${Do}
    ${IfNot} ${FileExists} "$1"
      ${ExitDo}
    ${EndIf}
    ; A mapped Windows executable cannot be opened for writing. Never alter it here.
    System::Call 'kernel32::CreateFileW(w r1, i 0x40000000, i 1, p 0, i 3, i 0, p 0)p.r0'
    ${If} $0 != -1
      System::Call 'kernel32::CloseHandle(p r0)'
      ${ExitDo}
    ${EndIf}
    IntOp $2 $2 + 1
    ${If} $2 >= 10
      MessageBox MB_OK|MB_ICONSTOP "Close all Loadstone windows before installing or uninstalling. No app processes were stopped." /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    Sleep 500
  ${Loop}
!macroend
