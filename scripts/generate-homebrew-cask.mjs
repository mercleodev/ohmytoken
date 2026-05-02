#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT = "release/ohmytoken.rb";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for --${name}`);
  }
  return value;
}

function normalizeRepositoryUrl(repositoryUrl) {
  return repositoryUrl
    .replace(/^git\+/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function findDefaultDmg(packageVersion) {
  const releaseDir = path.resolve("release");
  if (!fs.existsSync(releaseDir)) return undefined;

  const candidates = fs
    .readdirSync(releaseDir)
    .filter((fileName) => fileName.endsWith(".dmg"))
    .filter((fileName) => !fileName.endsWith(".dmg.blockmap"))
    .filter((fileName) => fileName.includes(packageVersion))
    .sort();

  const arm64Candidate = candidates.find((fileName) =>
    fileName.includes("-arm64"),
  );
  const selected = arm64Candidate ?? candidates[0];

  return selected ? path.join(releaseDir, selected) : undefined;
}

function rubyString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeVersionFromTag(tag) {
  return tag.replace(/^v/, "");
}

function generateCask({ repository, version, sha256, url }) {
  return `cask "ohmytoken" do
  version "${rubyString(version)}"
  sha256 "${rubyString(sha256)}"

  url "${rubyString(url)}",
      verified: "github.com/${repository}/"
  name "OhMyToken"
  desc "Real-time AI agent token usage monitor for Claude, Codex, and Gemini"
  homepage "https://github.com/${repository}"

  app "OhMyToken.app"

  zap trash: [
    "~/Library/Application Support/OhMyToken",
    "~/Library/Preferences/com.ohmytoken.monitor.plist",
    "~/Library/Saved Application State/com.ohmytoken.monitor.savedState",
  ]

  livecheck do
    skip "QA prerelease casks are generated per release."
  end
end
`;
}

const packageJson = readJson("package.json");
const packageVersion = packageJson.version;
const repository =
  readOption("repository") ??
  process.env.GITHUB_REPOSITORY ??
  normalizeRepositoryUrl(packageJson.repository.url);

const tag = readOption("tag") ?? process.env.RELEASE_TAG ?? `v${packageVersion}`;
const version = readOption("version") ?? normalizeVersionFromTag(tag);
const dmgInput = readOption("dmg") ?? findDefaultDmg(packageVersion);
const outputPath = path.resolve(readOption("output") ?? DEFAULT_OUTPUT);

if (!dmgInput) {
  throw new Error(
    "DMG file not found. Pass --dmg release/OhMyToken-<version>-arm64.dmg or run npm run build first.",
  );
}

const dmgPath = path.resolve(dmgInput);

if (!fs.existsSync(dmgPath) || !fs.statSync(dmgPath).isFile()) {
  throw new Error(
    "DMG file not found. Pass --dmg release/OhMyToken-<version>-arm64.dmg or run npm run build first.",
  );
}

const dmgFileName = path.basename(dmgPath);
const sha256 = readOption("sha256") ?? sha256File(dmgPath);
const url =
  readOption("url") ??
  `https://github.com/${repository}/releases/download/${tag}/${dmgFileName}`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  generateCask({ repository, version, sha256, url }),
);

console.log(`Generated ${path.relative(process.cwd(), outputPath)}`);
console.log(`Repository: ${repository}`);
console.log(`Version: ${version}`);
console.log(`URL: ${url}`);
console.log(`SHA-256: ${sha256}`);
