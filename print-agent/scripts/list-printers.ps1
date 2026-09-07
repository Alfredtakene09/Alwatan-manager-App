# Liste les imprimantes Windows visibles sur ce poste.
Get-CimInstance Win32_Printer |
    Sort-Object Name |
    ForEach-Object {
        $status = if ($_.WorkOffline) { 'OFFLINE' } else { 'OK' }
        $default = if ($_.Default) { ' (defaut)' } else { '' }
        '{0,-40}  {1}{2}' -f $_.Name, $status, $default
    }
