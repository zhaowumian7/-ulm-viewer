param(
  [Parameter(Mandatory = $true)]
  [string]$RepoUrl
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path ".git")) {
  git init
}

git branch -M main

$origin = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0) {
  if ($origin -ne $RepoUrl) {
    git remote set-url origin $RepoUrl
  }
} else {
  git remote add origin $RepoUrl
}

$changes = git status --short
if ($changes) {
  git add .
  git commit -m "Update 3D ULM viewers"
}

git push -u origin main

