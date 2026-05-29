#requires -Version 5.1
<#
.SYNOPSIS
    One-shot release pipeline for the Polyvoice VS Code extension.

.DESCRIPTION
    Bumps version, builds, commits, tags, pushes to GitHub, and publishes to
    the VS Code Marketplace. The vsce PAT is read from the credential store
    that `vsce login` already populated at ~/.vsce — no PAT handling here.

.PARAMETER Bump
    Version bump type or explicit semver string.
      patch  -> 0.1.15 -> 0.1.16   (default)
      minor  -> 0.1.15 -> 0.2.0
      major  -> 0.1.15 -> 1.0.0
      0.5.0  -> sets exact version

.PARAMETER Notes
    One-line changelog entry. If omitted, the script prompts.

.PARAMETER SkipPublish
    Build + commit + tag + push, but do NOT publish to Marketplace.

.PARAMETER SkipInstall
    Don't install the resulting .vsix into the local VS Code afterwards.

.PARAMETER DryRun
    Print the planned actions without executing destructive ones.

.EXAMPLE
    pwsh -File scripts/release.ps1
    # patch bump + publish with interactive changelog prompt

.EXAMPLE
    pwsh -File scripts/release.ps1 -Bump minor -Notes "Add Polly provider"

.EXAMPLE
    pwsh -File scripts/release.ps1 -Bump 0.5.0 -SkipPublish
#>
[CmdletBinding()]
param(
    [string]$Bump = 'patch',
    [string]$Notes,
    [switch]$SkipPublish,
    [switch]$SkipInstall,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Locate repo root ------------------------------------------------------
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

function Write-Step ($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok   ($msg) { Write-Host "    $msg"   -ForegroundColor Green }
function Write-Skip ($msg) { Write-Host "    [skip] $msg" -ForegroundColor DarkGray }

function Invoke-Step {
    param([string]$Label, [scriptblock]$Action)
    if ($DryRun) { Write-Skip "$Label (dry-run)"; return }
    & $Action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "Step failed: $Label (exit $LASTEXITCODE)"
    }
}

# --- 1. Pre-flight ---------------------------------------------------------
Write-Step "Pre-flight checks"

$dirty = (git status --porcelain)
if ($dirty) {
    Write-Host $dirty -ForegroundColor Yellow
    $resp = Read-Host "Working tree is dirty. Commit these changes as part of the release? (y/n)"
    if ($resp -ne 'y') { throw "Aborted: clean the working tree first." }
}
Write-Ok "git status checked"

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') {
    $resp = Read-Host "You are on branch '$branch', not 'main'. Continue? (y/n)"
    if ($resp -ne 'y') { throw "Aborted." }
}
Write-Ok "branch: $branch"

# Verify vsce credential is cached
if (-not (Test-Path "$HOME\.vsce")) {
    Write-Host "No cached vsce credential found." -ForegroundColor Yellow
    Write-Host "Run: npx vsce login dorofino    (then re-run this script)" -ForegroundColor Yellow
    throw "Missing vsce credential."
}
Write-Ok "vsce credential present"

# --- 2. Determine new version ---------------------------------------------
Write-Step "Resolving version"

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$current = $pkg.version
Write-Host "    current: $current"

function Step-Version ($v, $kind) {
    $parts = $v.Split('.') | ForEach-Object { [int]$_ }
    switch ($kind) {
        'patch' { $parts[2]++ }
        'minor' { $parts[1]++; $parts[2] = 0 }
        'major' { $parts[0]++; $parts[1] = 0; $parts[2] = 0 }
        default { throw "unknown bump '$kind'" }
    }
    return ($parts -join '.')
}

if ($Bump -match '^\d+\.\d+\.\d+$') {
    $next = $Bump
} elseif ($Bump -in @('patch', 'minor', 'major')) {
    $next = Step-Version $current $Bump
} else {
    throw "Invalid -Bump value '$Bump'. Use patch | minor | major | x.y.z"
}
Write-Ok "next   : $next"

# --- 3. Changelog entry ---------------------------------------------------
Write-Step "Changelog"

if (-not $Notes) {
    Write-Host "    Enter a one-line summary for the changelog (blank to skip)."
    $Notes = Read-Host "    > "
}

if ($Notes) {
    $date = Get-Date -Format 'yyyy-MM-dd'
    $entry = @"
## [$next] - $date

- $Notes

"@
    if (-not $DryRun) {
        $existing = Get-Content CHANGELOG.md -Raw
        # Insert after the title block (after the first blank line following "# Changelog")
        $header, $rest = $existing -split "(?ms)(?<=^All notable changes.*?$\r?\n\r?\n)", 2
        if ($rest) {
            Set-Content CHANGELOG.md -Value ($header + $entry + $rest) -NoNewline
        } else {
            # Fallback: prepend
            Set-Content CHANGELOG.md -Value ($entry + $existing) -NoNewline
        }
    }
    Write-Ok "CHANGELOG.md updated"
} else {
    Write-Skip "no changelog entry"
}

# --- 4. Bump package.json -------------------------------------------------
Write-Step "Bumping package.json -> $next"
Invoke-Step "npm version" { npm version $next --no-git-tag-version --allow-same-version | Out-Null }
Write-Ok "package.json @ $next"

# --- 5. Build -------------------------------------------------------------
Write-Step "Building"
Invoke-Step "npm run build" { npm run build | Out-Null }
Write-Ok "dist/extension.js built"

# --- 6. Package (sanity check) --------------------------------------------
Write-Step "Packaging .vsix"
$vsix = "polyvoice-$next.vsix"
Invoke-Step "vsce package" {
    npx vsce package --out $vsix | Out-Null
}
if (-not $DryRun) {
    $size = [math]::Round((Get-Item $vsix).Length / 1KB, 1)
    Write-Ok "$vsix  ($size KB)"
}

# --- 7. Commit + tag + push ----------------------------------------------
Write-Step "Git commit + tag + push"
$commitMsg = "chore: release $next"
if ($Notes) { $commitMsg += " - $Notes" }

Invoke-Step "git add" { git add -A | Out-Null }
Invoke-Step "git commit" { git commit -m $commitMsg | Out-Null }
Invoke-Step "git tag" { git tag "v$next" | Out-Null }
Invoke-Step "git push" { git push --follow-tags 2>&1 | Out-Null }
Write-Ok "pushed v$next to origin"

# --- 8. Publish to Marketplace -------------------------------------------
if ($SkipPublish) {
    Write-Skip "Marketplace publish (-SkipPublish)"
} else {
    Write-Step "Publishing to VS Code Marketplace"
    Invoke-Step "vsce publish" {
        npx vsce publish --packagePath $vsix
    }
    Write-Ok "https://marketplace.visualstudio.com/items?itemName=dorofino.polyvoice"
}

# --- 9. Local install (optional) -----------------------------------------
if (-not $SkipInstall) {
    Write-Step "Installing locally"
    $codeCmd = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
    if (Test-Path $codeCmd) {
        Invoke-Step "code --install-extension" {
            & $codeCmd --install-extension $vsix --force | Out-Null
        }
        Write-Ok "installed in local VS Code"
    } else {
        Write-Skip "code.cmd not found at $codeCmd"
    }
}

# --- 10. GitHub release (optional, requires gh CLI) ----------------------
Write-Step "GitHub release"
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    $ghNotes = if ($Notes) { $Notes } else { "Release $next" }
    Invoke-Step "gh release create" {
        gh release create "v$next" $vsix --title "v$next" --notes $ghNotes 2>&1 | Out-Null
    }
    Write-Ok "gh release v$next created with $vsix attached"
} else {
    Write-Skip "gh CLI not installed"
}

Write-Host ""
Write-Host "Release $next complete." -ForegroundColor Green
if (-not $SkipPublish) {
    Write-Host "Listing: https://marketplace.visualstudio.com/items?itemName=dorofino.polyvoice" -ForegroundColor Green
    Write-Host "(give it 1-5 min to refresh)" -ForegroundColor DarkGray
}
