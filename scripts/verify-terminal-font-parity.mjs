#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SCRIPT_NAME = "verify-terminal-font-parity";
const cwd = process.cwd();

function formatMessage(message) {
  return `[${SCRIPT_NAME}] ${message}`;
}

function fail(message) {
  console.error(formatMessage(message));
  process.exit(1);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/verify-terminal-font-parity.mjs [options]",
    "",
    "Options:",
    "  --bundle-root <path>      Tauri bundle output root (default: src-tauri/target/release/bundle)",
    "  --dist-assets-root <path> Frontend assets root (default: dist/assets)",
    "  --expect-font <value>     Font filename token to find in packaged output (default: JetBrainsMonoNerdFontMono-Regular)",
    "  --expect-token <value>    Token required in built frontend artifacts (default: VibetreeNerdMono)",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    bundleRoot: "src-tauri/target/release/bundle",
    distAssetsRoot: "dist/assets",
    expectFont: "JetBrainsMonoNerdFontMono-Regular",
    expectToken: "VibetreeNerdMono",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      fail(`Unknown positional argument: ${arg}\n${usage()}`);
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      fail(`Missing value for ${arg}\n${usage()}`);
    }

    switch (arg) {
      case "--bundle-root":
        options.bundleRoot = nextValue;
        break;
      case "--dist-assets-root":
        options.distAssetsRoot = nextValue;
        break;
      case "--expect-font":
        options.expectFont = nextValue;
        break;
      case "--expect-token":
        options.expectToken = nextValue;
        break;
      default:
        fail(`Unknown option: ${arg}\n${usage()}`);
    }

    index += 1;
  }

  return options;
}

function listFilesRecursively(rootDir) {
  const filePaths = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        filePaths.push(fullPath);
      }
    }
  }

  return filePaths.sort((a, b) => a.localeCompare(b));
}

function getRelativePath(filePath) {
  return path.relative(cwd, filePath).split(path.sep).join("/");
}

const options = parseArgs(process.argv.slice(2));
const bundleRoot = path.resolve(cwd, options.bundleRoot);
const distAssetsRoot = path.resolve(cwd, options.distAssetsRoot);

if (!existsSync(bundleRoot)) {
  fail(`Bundle directory not found: ${getRelativePath(bundleRoot)}`);
}

if (!existsSync(distAssetsRoot)) {
  fail(`Frontend assets directory not found: ${getRelativePath(distAssetsRoot)}`);
}

const bundleFiles = listFilesRecursively(bundleRoot);
if (bundleFiles.length === 0) {
  fail(`Bundle directory has no files: ${getRelativePath(bundleRoot)}`);
}

const distFiles = listFilesRecursively(distAssetsRoot);

// Check 1: Packaged bundle must contain font marker (not dist fallback)
// Supports both loose .ttf files and embedded fonts in binaries (macOS .app layout)
const packagedFontMatches = bundleFiles.filter((filePath) => {
  const fileName = path.basename(filePath);
  // Check for loose .ttf file
  if (fileName.endsWith(".ttf") && fileName.includes(options.expectFont)) {
    return true;
  }
  return false;
});

// If no loose .ttf found, scan binary files for font token (macOS embedded case)
let binaryFontMatch = null;
if (packagedFontMatches.length === 0) {
  const binaryFiles = bundleFiles.filter((filePath) => {
    const fileName = path.basename(filePath);
    // Common binary extensions that may contain embedded fonts
    return fileName.endsWith(".app") || fileName.includes("vibetree");
  });

  for (const binaryPath of binaryFiles) {
    try {
      const content = readFileSync(binaryPath, "utf8");
      if (content.includes(options.expectFont)) {
        binaryFontMatch = binaryPath;
        break;
      }
    } catch {
      // Skip files that can't be read as text
    }
  }
}

if (packagedFontMatches.length === 0 && !binaryFontMatch) {
  fail(
    `Expected font containing "${options.expectFont}" not found in packaged bundle under ${getRelativePath(bundleRoot)}.`,
  );
}
const textFiles = distFiles.filter((filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".css" || extension === ".js" || extension === ".html";
});

if (textFiles.length === 0) {
  fail(`No text assets found under ${getRelativePath(distAssetsRoot)} to inspect token usage.`);
}

const tokenMatches = [];
for (const filePath of textFiles) {
  const content = readFileSync(filePath, "utf8");
  if (content.includes(options.expectToken)) {
    tokenMatches.push(filePath);
  }
}

if (tokenMatches.length === 0) {
  fail(
    `Expected token "${options.expectToken}" not found in built frontend assets under ${getRelativePath(distAssetsRoot)}.`,
  );
}

const packagedFontPath = packagedFontMatches.length > 0
  ? getRelativePath(packagedFontMatches[0])
  : getRelativePath(binaryFontMatch);

console.log(
  formatMessage(
    [
      `PASS packaged-font=${packagedFontPath}`,
      `frontend-token=${options.expectToken}`,
      `token-file=${getRelativePath(tokenMatches[0])}`,
    ].join(" | "),
  ),
);
