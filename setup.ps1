# Ski game setup: installs the tools, adds the MCP servers and plugin,
# signs in to GitHub, then starts Claude Code in this folder.
$project = $PSScriptRoot

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User') + ';' +
              "$env:USERPROFILE\.local\bin"
}
function Has($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Step($text) { Write-Host ''; Write-Host "== $text ==" -ForegroundColor Cyan }

Step '1/5  Git, Node.js and GitHub CLI'
Write-Host 'If winget asks you to accept agreements, type Y. Click Yes on any admin prompts.'
foreach ($id in 'Git.Git', 'OpenJS.NodeJS.LTS', 'GitHub.cli') {
  winget install --id $id --exact --source winget
}
Refresh-Path

Step '2/5  Claude Code'
if (Has 'claude') {
  Write-Host 'Already installed.'
} else {
  irm https://claude.ai/install.ps1 | iex
  Refresh-Path
}
if (-not (Has 'claude')) {
  Write-Host 'Claude Code did not install. Close this window and run setup again.' -ForegroundColor Red
  exit 1
}

Step '3/5  MCP servers: Playwright, Context7, Chrome DevTools'
claude mcp add --scope user playwright '--' cmd /c npx -y '@playwright/mcp@latest'
claude mcp add --scope user context7 '--' cmd /c npx -y '@upstash/context7-mcp'
claude mcp add --scope user chrome-devtools '--' cmd /c npx -y 'chrome-devtools-mcp@latest' '--no-usage-statistics'
Write-Host '(An "already exists" message just means that one was set up before.)'

Step '4/5  frontend-design plugin'
claude plugin install 'frontend-design@claude-plugins-official'
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Plugin did not install from here. Inside Claude Code, run: /plugin install frontend-design@claude-plugins-official' -ForegroundColor Yellow
}

Step '5/5  GitHub sign-in'
gh auth status *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Already signed in.'
} else {
  gh auth login --hostname github.com --git-protocol https --web
}

Step 'Check'
git --version
node --version
gh --version | Select-Object -First 1
claude --version
claude mcp list

Write-Host ''
Write-Host "All set. Press Enter to start Claude Code in $project" -ForegroundColor Green
Read-Host | Out-Null
Set-Location $project
claude
