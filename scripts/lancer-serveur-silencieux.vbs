' Lancement sans fen??tre console ??? Clinique Alwatan Manager
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strPs1 = strDir & "\lancer-serveur.ps1"
strCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & strPs1 & """"
objShell.Run strCmd, 0, False
