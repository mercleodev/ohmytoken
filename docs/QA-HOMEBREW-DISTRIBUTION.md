# QA Homebrew Distribution

This document describes the temporary distribution path for installing
OhMyToken on another Mac before the official 1.0.0 release.

## Scope

- This path is for QA builds only.
- The build is unsigned and not notarized unless Apple Developer credentials are
  added later.
- The recommended Homebrew path is a private project tap, not the official
  `homebrew/cask` repository.

## Release Flow

Create a QA prerelease from the GitHub Actions `qa-release` workflow.

Recommended tag format:

```bash
v0.1.0-qa.1
```

The workflow builds the macOS app, publishes a GitHub prerelease, and attaches:

- `OhMyToken-<version>-<arch>.dmg`
- `OhMyToken-<version>-<arch>-mac.zip` or the matching generated ZIP artifact
- `ohmytoken.rb`
- `SHA256SUMS.txt`

The attached `ohmytoken.rb` is the generated Homebrew cask file for the QA
release.

## Tap Repository

Use a separate tap repository:

```text
github.com/<owner>/homebrew-tap
```

The tap should contain:

```text
Casks/ohmytoken.rb
```

After the QA release is created, place the generated `ohmytoken.rb` from the
release assets at that path, then commit and push the tap repository.

## QA Install Command

On another Mac:

```bash
brew tap <owner>/tap
brew install --cask ohmytoken
```

For repeat QA installs:

```bash
brew update
brew reinstall --cask ohmytoken
```

## Gatekeeper Note

Unsigned QA builds may be blocked by macOS Gatekeeper. For trusted internal QA
builds, testers can use Finder's secondary-click Open flow. The broader public
distribution path should use Developer ID signing and notarization.

## Local Cask Generation

To generate a cask from a local DMG:

```bash
npm run build
node scripts/generate-homebrew-cask.mjs \
  --tag v0.1.0-qa.1 \
  --dmg release/OhMyToken-0.1.0-arm64.dmg \
  --output release/ohmytoken.rb
```

The script computes the DMG SHA-256 and writes a cask pointing at the matching
GitHub Release asset URL.
