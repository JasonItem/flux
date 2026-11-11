; Custom NSIS: assisted uninstall can optionally wipe Electron user data.
; Uninstaller-only pages/functions must stay behind BUILD_UNINSTALLER,
; otherwise makensis warns (treated as error) when building the installer.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var DeleteUserDataCheckbox
Var DeleteUserDataState

!macro customUnWelcomePage
  UninstPage custom un.CustomWelcomeCreate un.CustomWelcomeLeave
!macroend

!ifdef BUILD_UNINSTALLER
  Function un.CustomWelcomeCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 48u "即将卸载 ${PRODUCT_NAME}。$\r$\n$\r$\n默认只删除程序文件。如需一并清除本机数据库、配置与缓存，请勾选下方选项。"
    Pop $0

    ${NSD_CreateCheckbox} 0 70u 100% 16u "清除用户数据（数据库 / 配置 / 缓存，不可恢复）"
    Pop $DeleteUserDataCheckbox
    ${NSD_SetState} $DeleteUserDataCheckbox ${BST_UNCHECKED}

    nsDialogs::Show
  FunctionEnd

  Function un.CustomWelcomeLeave
    ${NSD_GetState} $DeleteUserDataCheckbox $DeleteUserDataState
  FunctionEnd
!endif

!macro customUnInstall
  ${If} $DeleteUserDataState == ${BST_CHECKED}
    ; Electron userData is always per-user
    SetShellVarContext current

    RMDir /r "$APPDATA\${APP_FILENAME}"
    RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"

    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      RMDir /r "$LOCALAPPDATA\${APP_PRODUCT_FILENAME}"
    !endif

    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
    !endif

    ; Legacy renamed product folders on this machine
    RMDir /r "$APPDATA\MediaRet"
    RMDir /r "$APPDATA\AI自媒体工作台"
    RMDir /r "$LOCALAPPDATA\MediaRet"
    RMDir /r "$LOCALAPPDATA\AI自媒体工作台"
  ${EndIf}
!macroend
