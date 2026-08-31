# Acces Alwatan : PC cabinet via Ethernet ; 1 utilisateur distant via Tailscale.
# Dot-source apres _alwatan-common.ps1

function Get-AlwatanEthernetIpv4 {
    # Detection automatique (DHCP ou manuelle) : IP Ethernet Preferree, hors conflit.
    $addrs = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.IPAddress -notlike '192.168.137.*' -and
            $_.InterfaceAlias -match '(?i)^Ethernet' -and
            $_.InterfaceAlias -notmatch '(?i)tailscale|bluetooth|virtual|vether|hyper-v' -and
            $_.AddressState -ne 'Duplicate' -and
            $_.AddressState -ne 'Tentative' -and
            -not (Test-AlwatanTailscaleIpv4 $_.IPAddress)
        })
    if (-not $addrs -or $addrs.Count -eq 0) { return $null }
    $preferred = @($addrs | Where-Object { $_.AddressState -eq 'Preferred' } | Sort-Object InterfaceMetric)
    if ($preferred.Count -gt 0) { return $preferred[0].IPAddress }
    return ($addrs | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress)
}

function Get-AlwatanWifiInterfaceAliases {
    @(Get-NetAdapter -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)wi-?fi|wlan|wireless' } |
        Select-Object -ExpandProperty Name)
}

function Get-AlwatanEthernetInterfaceAliases {
    @(Get-NetAdapter -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match '(?i)^Ethernet' -and
            $_.Name -notmatch '(?i)tailscale|bluetooth|virtual'
        } |
        Select-Object -ExpandProperty Name)
}

function Get-AlwatanTailscaleInterfaceAliases {
    @(Get-NetAdapter -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)tailscale' } |
        Select-Object -ExpandProperty Name)
}

function Get-AlwatanWifiIpv4List {
    $aliases = Get-AlwatanWifiInterfaceAliases
    if (-not $aliases -or $aliases.Count -eq 0) { return @() }
    @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            ($aliases -contains $_.InterfaceAlias) -and
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*'
        } |
        Select-Object -ExpandProperty IPAddress -Unique)
}

function Read-AlwatanAccessMode {
    param([string]$Root = (Get-AlwatanRoot))
    $envFile = Join-Path $Root 'backend\.env'
    if (-not (Test-Path $envFile)) { return '' }
    $line = Get-Content $envFile -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^\s*ALWATAN_ACCESS_MODE\s*=' } |
        Select-Object -First 1
    if (-not $line) { return '' }
    if ($line -match '=\s*"?([^"#\r\n]+)"?') { return $Matches[1].Trim() }
    return ''
}

function Set-AlwatanAccessMode {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Mode
    )
    $envFile = Join-Path $Root 'backend\.env'
    if (-not (Test-Path $envFile)) { return }
    $lines = Get-Content $envFile -ErrorAction SilentlyContinue
    $out = [System.Collections.Generic.List[string]]::new()
    $seen = $false
    foreach ($line in $lines) {
        if ($line -match '^\s*ALWATAN_ACCESS_MODE\s*=') {
            [void]$out.Add("ALWATAN_ACCESS_MODE=$Mode")
            $seen = $true
            continue
        }
        [void]$out.Add($line)
    }
    if (-not $seen) { [void]$out.Add("ALWATAN_ACCESS_MODE=$Mode") }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines((Resolve-Path $envFile), $out.ToArray(), $utf8)
}

function Ensure-AlwatanEthernetTailscaleFirewall {
    param([int[]]$Ports = @(4000))

    if (-not (Test-AlwatanIsAdmin)) {
        Write-Host 'Pare-feu Ethernet/Tailscale : droits Administrateur requis.' -ForegroundColor Yellow
        Write-Host 'Lancez : scripts\configurer-acces-ethernet-tailscale.cmd' -ForegroundColor Yellow
        return $false
    }

    $ethIfaces = Get-AlwatanEthernetInterfaceAliases
    $tsIfaces = Get-AlwatanTailscaleInterfaceAliases
    $wifiIfaces = Get-AlwatanWifiInterfaceAliases

    foreach ($port in $Ports) {
        foreach ($legacy in @(
            "Alwatan Manager LAN TCP $port",
            "Alwatan Manager LAN TCP $port (netsh)"
        )) {
            Get-NetFirewallRule -DisplayName $legacy -ErrorAction SilentlyContinue |
                Remove-NetFirewallRule -ErrorAction SilentlyContinue
            netsh advfirewall firewall delete rule name="$legacy" 2>$null | Out-Null
        }

        foreach ($iface in $ethIfaces) {
            $name = "Alwatan Allow Ethernet TCP $port ($iface)"
            Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue |
                Remove-NetFirewallRule -ErrorAction SilentlyContinue
            try {
                New-NetFirewallRule `
                    -DisplayName $name `
                    -Direction Inbound `
                    -Action Allow `
                    -Protocol TCP `
                    -LocalPort $port `
                    -InterfaceAlias $iface `
                    -Profile Any `
                    -Description 'Alwatan: PC cabinet via Ethernet' | Out-Null
                Write-Host "Pare-feu ALLOW Ethernet ($iface) : TCP $port" -ForegroundColor Green
            } catch {
                Write-Host "Echec regle Ethernet $iface" -ForegroundColor Yellow
            }
        }

        foreach ($iface in $tsIfaces) {
            $name = "Alwatan Allow Tailscale TCP $port ($iface)"
            Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue |
                Remove-NetFirewallRule -ErrorAction SilentlyContinue
            try {
                New-NetFirewallRule `
                    -DisplayName $name `
                    -Direction Inbound `
                    -Action Allow `
                    -Protocol TCP `
                    -LocalPort $port `
                    -InterfaceAlias $iface `
                    -Profile Any `
                    -Description 'Alwatan: acces Tailscale distant' | Out-Null
                Write-Host "Pare-feu ALLOW Tailscale ($iface) : TCP $port" -ForegroundColor Green
            } catch {
                Write-Host "Echec regle Tailscale $iface" -ForegroundColor Yellow
            }
        }

        foreach ($iface in $wifiIfaces) {
            $name = "Alwatan Block Wi-Fi TCP $port ($iface)"
            Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue |
                Remove-NetFirewallRule -ErrorAction SilentlyContinue
            try {
                New-NetFirewallRule `
                    -DisplayName $name `
                    -Direction Inbound `
                    -Action Block `
                    -Protocol TCP `
                    -LocalPort $port `
                    -InterfaceAlias $iface `
                    -Profile Any `
                    -Description 'Alwatan: bloquer Wi-Fi serveur' | Out-Null
                Write-Host "Pare-feu BLOCK Wi-Fi ($iface) : TCP $port" -ForegroundColor Yellow
            } catch {
                Write-Host "Echec regle Wi-Fi $iface" -ForegroundColor Yellow
            }
        }

        $loopName = "Alwatan Allow Loopback TCP $port"
        Get-NetFirewallRule -DisplayName $loopName -ErrorAction SilentlyContinue |
            Remove-NetFirewallRule -ErrorAction SilentlyContinue
        try {
            New-NetFirewallRule `
                -DisplayName $loopName `
                -Direction Inbound `
                -Action Allow `
                -Protocol TCP `
                -LocalPort $port `
                -LocalAddress 127.0.0.1 `
                -Profile Any `
                -Description 'Alwatan: localhost' | Out-Null
        } catch { }
    }

    Ensure-AlwatanNodeFirewall
    return $true
}

function Apply-AlwatanEthernetTailscaleAccess {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [int]$Port = 4000,
        [switch]$ConfigureFirewall
    )

    $ethIp = Get-AlwatanEthernetIpv4
    $tsIp = Get-TailscaleIpv4
    if (-not $ethIp) {
        $dup = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.InterfaceAlias -match '(?i)^Ethernet' -and
                $_.AddressState -eq 'Duplicate'
            } |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($dup) {
            Write-Host "IP Ethernet en conflit (Duplicate) : $dup" -ForegroundColor Red
            Write-Host 'Changez l''IP Ethernet du serveur (ex. 192.168.88.50) puis relancez.' -ForegroundColor Yellow
            Write-Host 'En attendant, les PC peuvent utiliser le Wi-Fi serveur + Tailscale.' -ForegroundColor DarkGray
        } else {
            Write-Host 'Aucune IP Ethernet cablee detectee. Branchez le cable puis relancez.' -ForegroundColor Red
        }
        return $false
    }

    Write-AlwatanServerConfig -ServerIp $ethIp -TailscaleIp $tsIp

    $corsIps = [System.Collections.Generic.List[string]]::new()
    [void]$corsIps.Add($ethIp)
    if ($tsIp) { [void]$corsIps.Add($tsIp) }

    Sync-AlwatanLanConfig -Root $Root -LanIp $ethIp -LanIps $corsIps.ToArray()
    Set-AlwatanAccessMode -Root $Root -Mode 'ethernet_tailscale'

    if ($ConfigureFirewall) {
        Ensure-AlwatanEthernetTailscaleFirewall -Ports @($Port) | Out-Null
    }

    Write-Host ''
    Write-Host '  Politique acces Alwatan' -ForegroundColor Cyan
    Write-Host "  PC cabinet (Ethernet) : http://${ethIp}:${Port}/" -ForegroundColor Green
    if ($tsIp) {
        Write-Host "  Utilisateur Tailscale (PC/mobile) : http://${tsIp}:${Port}/" -ForegroundColor Green
    } else {
        Write-Host '  Tailscale : non detecte.' -ForegroundColor Yellow
    }
    $wifiIps = Get-AlwatanWifiIpv4List
    if ($wifiIps.Count -gt 0) {
        Write-Host "  IP Wi-Fi serveur non publiee aux clients : $($wifiIps -join ', ')" -ForegroundColor DarkGray
    }
    Write-Host ''
    return $true
}
