# Polyvoice — Developer Guide

How to build, test, and release the Polyvoice VS Code extension.

## Prerequisites 

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 18+ (20 LTS recommended) | Runtime for build + vsce |
| **npm** | 9+ | Package manager |
| **PowerShell** | 5.1+ or PowerShell 7 (`pwsh`) | Release script |
| **git** | 2.30+ | Version control |
| **gh** (GitHub CLI) | optional | For automatic GitHub Releases with `.vsix` attached |
| **VS Code** | 1.90+ | To run/debug the extension |

First-time clone:

```powershell
git clone https://github.com/dorofino/Polyvoice.git
cd Polyvoice
npm install
```

---

## Build

Production bundle (what gets shipped):

```powershell
npm run build
```

Output: `dist/extension.js` (~536 KB).

Continuous rebuild while developing:

```powershell
npm run watch
```

---

## Test locally

### Option A — Extension Development Host (recommended)

1. Open the repo in VS Code.
2. Press **F5** (or *Run → Start Debugging*).
3. A second VS Code window opens with **[Extension Development Host]** in the title bar — your extension is live in that window only.
4. Set breakpoints in `src/**/*.ts`; they hit in the original window's debugger.
5. Reload the host window after changes: **Ctrl+R** inside the host window.

### Option B — Package and install locally

Build a `.vsix` and install it into your real VS Code:

```powershell
npm run package
code --install-extension polyvoice-<version>.vsix --force
```

(If `code` isn't on your PATH, use the full path to `code.cmd` from your VS
Code install — usually under `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin`
on Windows.)

Then reload VS Code (Ctrl+Shift+P → *Developer: Reload Window*).

### Smoke test checklist

Before releasing, verify each provider you care about:

- [ ] **Native OS** — select text → `Ctrl+Alt+S`. Should speak immediately, no setup.
- [ ] **OpenAI** — *Polyvoice: Select Provider* → OpenAI → paste API key → speak.
- [ ] **Azure** — set region (e.g. `eastus`) in settings → select voice → speak.
- [ ] **ElevenLabs** — set API key → speak.
- [ ] **xAI** — set API key → speak.
- [ ] **Speak Clipboard** — copy something outside VS Code → run *Polyvoice: Speak Clipboard*.
- [ ] **Status bar quick menu** — click the Polyvoice item → all entries work.

---

## Release

The full release pipeline is automated by `scripts/release.ps1`. It bumps the
version, builds, packages, commits, tags, pushes to GitHub, publishes to the
Marketplace, installs locally, and creates a GitHub Release with the `.vsix`
attached.

### One-time setup

You need a **Personal Access Token (PAT)** from Azure DevOps to publish.

1. Go to https://dev.azure.com → sign in with the **same Microsoft account**
   that owns the Marketplace publisher.
2. Top-right user icon → **Personal access tokens** → **+ New Token**.
3. Settings:
   - **Name**: `vsce-publish`
   - **Organization**: **All accessible organizations** *(critical — the default is wrong)*
   - **Expiration**: 1 year (max)
   - **Scopes**: **Show all scopes** → **Marketplace** → check **Manage**
4. **Create** → **copy the token** (only shown once).
5. Cache it locally — you only do this once:

   ```powershell
   npx vsce login <publisher-id>
   # paste the PAT at the prompt
   ```

   (Your `<publisher-id>` is the value of `"publisher"` in `package.json`.)

   This stores the token under your OS user profile (`~/.vsce` on macOS/Linux,
   `%USERPROFILE%\.vsce` on Windows). Every future `vsce publish` reads it
   automatically. **No re-entry needed until the PAT expires (~1 year).**

When the PAT eventually expires, you'll see a `401 Unauthorized` from
`vsce publish`. Create a new PAT and run `npx vsce login <publisher-id>`
again — done.

### Cutting a release

From the repo root, pick the bump type:

```powershell
npm run release:patch     # 0.1.15 -> 0.1.16  (bug fixes)
npm run release:minor     # 0.1.15 -> 0.2.0   (new features, backwards compatible)
npm run release:major     # 0.1.15 -> 1.0.0   (breaking changes)
```

Or call the script directly for more control:

```powershell
# Set an exact version
pwsh -File scripts/release.ps1 -Bump 0.5.0

# Provide changelog note inline (skips the interactive prompt)
pwsh -File scripts/release.ps1 -Bump patch -Notes "Fix clipboard race condition"

# Build + commit + push, but DON'T publish to Marketplace
pwsh -File scripts/release.ps1 -Bump patch -SkipPublish

# Don't install into local VS Code after publishing
pwsh -File scripts/release.ps1 -Bump patch -SkipInstall

# Print planned actions without executing them
pwsh -File scripts/release.ps1 -Bump patch -DryRun
```

### What the script does

1. **Pre-flight** — checks working tree, current branch, vsce credential
2. **Resolve version** — bumps patch/minor/major or uses exact value
3. **Changelog** — prepends a dated entry to `CHANGELOG.md`
4. **Bump** — updates `package.json` (and `package-lock.json`)
5. **Build** — `npm run build` → `dist/extension.js`
6. **Package** — `vsce package` → `polyvoice-X.Y.Z.vsix`
7. **Git** — commit `chore: release X.Y.Z`, tag `vX.Y.Z`, push with tags
8. **Publish** — `vsce publish` to the Marketplace using cached PAT
9. **Install** — drops the new `.vsix` into your local VS Code
10. **GitHub Release** — `gh release create` with the `.vsix` attached (if `gh` is installed)

If a step fails the script aborts immediately. Re-run after fixing — `npm version`
won't double-bump because the script uses `--allow-same-version`.

### Manual fallback

If the script ever fails midway, the equivalent manual steps are:

```powershell
npm version 0.1.16 --no-git-tag-version
npm run build
npx vsce package
git add -A
git commit -m "chore: release 0.1.16"
git tag v0.1.16
git push --follow-tags
npx vsce publish --packagePath polyvoice-0.1.16.vsix
gh release create v0.1.16 polyvoice-0.1.16.vsix --title "v0.1.16" --notes "..."
```

---

## Verifying the release

- **Marketplace**: `https://marketplace.visualstudio.com/items?itemName=<publisher>.<name>`
  *(takes 1–5 min to refresh after publish)*
- **Publisher hub**: `https://marketplace.visualstudio.com/manage/publishers/<publisher>`
- **GitHub Releases**: see the repo's Releases tab
- **Installs**: visible in the Marketplace hub under the extension's Stats tab.

For end-user install verification, open VS Code on a clean profile:

```powershell
code --profile fresh --install-extension <publisher>.<name>
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `vsce publish` → **401 Unauthorized** | PAT expired or revoked. Create a new PAT and `npx vsce login <publisher-id>`. |
| `vsce publish` → **"The requested operation is not allowed"** | You're using `--azure-credential` without a tenant-linked publisher. Use PAT auth instead (default). |
| `gh release create` → **"tag X exists but has not been pushed"** | The git remote case doesn't match GitHub's canonical case. Fix with `git remote set-url origin <canonical-repo-url>`. |
| `npm run build` → **"Invalid package config"** with a `\\?\` path | Windows long-path / UNC issue. Open the terminal directly in the project folder (not via a junction), or run from a normal `cd` instead of an extension working dir. |
| Marketplace listing missing icon | Wait 5 minutes; CDN cache. If still missing, check `media/icon.png` is 128×128+ and `"icon"` is set in `package.json`. |
| Extension installed but doesn't activate | Check VS Code → *Output* panel → *Polyvoice* channel. Most often a missing or wrong API key. |

---

## Useful commands

```powershell
# Show what the .vsix will include
npx vsce ls

# Show full file tree
npx vsce ls --tree

# Show current publisher info
npx vsce show <publisher>.<name>

# Manually regenerate the extension icon
pwsh -File scripts/make-icon.ps1
```
