' Lancement Alwatan Manager
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strPs1 = strDir & "\lancer-serveur.ps1"
strLog = objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CliniqueAlwatan\last-launch.log"
On Error Resume Next
objFSO.CreateFolder objShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\CliniqueAlwatan"
On Error GoTo 0
strCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File """ & strPs1 & """ -Production"
objShell.Run strCmd, 0, False
