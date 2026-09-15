#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'android');
const releaseDir = path.join(root, 'release');
const outputReleaseApk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

function run(command, args, options = {}) {
  const suppressPatterns = Array.isArray(options.suppressPatterns) ? options.suppressPatterns : null;
  const shouldFilter = suppressPatterns && suppressPatterns.length > 0;
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: shouldFilter ? 'pipe' : 'inherit',
    env: options.env || process.env,
    shell: false,
    encoding: shouldFilter ? 'utf8' : undefined,
  });

  if (shouldFilter) {
    const emitFiltered = (text, writer) => {
      const lines = String(text || '').split(/\r?\n/);
      const kept = lines.filter((line) => !suppressPatterns.some((pattern) => pattern.test(line)));
      const payload = kept.join('\n').trim();
      if (payload) {
        writer.write(payload + '\n');
      }
    };
    emitFiltered(result.stdout, process.stdout);
    emitFiltered(result.stderr, process.stderr);
  }

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function readSigningConfigFromFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function looksLikePlaceholder(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return text.includes('<') || text.includes('placeholder') || text.includes('example') || text.includes('changeme');
}

function resolveSigningConfig() {
  const privateConfigPath = path.join(androidDir, 'signing.local.private.json');
  const localConfigPath = path.join(androidDir, 'signing.local.json');
  const fromPrivate = readSigningConfigFromFile(privateConfigPath);
  const fromLocal = readSigningConfigFromFile(localConfigPath);

  if (fromPrivate && !looksLikePlaceholder(fromPrivate.storePassword) && !looksLikePlaceholder(fromPrivate.keyPassword)) {
    return { config: fromPrivate, source: privateConfigPath };
  }
  if (fromLocal && !looksLikePlaceholder(fromLocal.storePassword) && !looksLikePlaceholder(fromLocal.keyPassword)) {
    return { config: fromLocal, source: localConfigPath };
  }
  return { config: null, source: null };
}

function resolveSigningEnv() {
  const resolved = resolveSigningConfig();
  const fromFile = resolved.config;
  const env = { ...process.env };
  const storeFile = env.NICE_RELEASE_STORE_FILE || fromFile?.storeFile;
  const storePassword = env.NICE_RELEASE_STORE_PASSWORD || fromFile?.storePassword;
  const keyAlias = env.NICE_RELEASE_KEY_ALIAS || fromFile?.keyAlias;
  const keyPassword = env.NICE_RELEASE_KEY_PASSWORD || fromFile?.keyPassword;

  const missing = [];
  if (!storeFile) missing.push('NICE_RELEASE_STORE_FILE');
  if (!storePassword) missing.push('NICE_RELEASE_STORE_PASSWORD');
  if (!keyAlias) missing.push('NICE_RELEASE_KEY_ALIAS');
  if (!keyPassword) missing.push('NICE_RELEASE_KEY_PASSWORD');
  if (missing.length > 0) {
    throw new Error(
      `Missing release signing credentials: ${missing.join(', ')}.\n` +
      'Provide them via environment variables, android/signing.local.private.json, or android/signing.local.json.'
    );
  }

  const normalizedStorePath = path.resolve(root, storeFile);
  if (!fs.existsSync(normalizedStorePath)) {
    throw new Error(`Release keystore not found: ${normalizedStorePath}`);
  }
  const lowerStore = normalizedStorePath.toLowerCase();
  const lowerAlias = String(keyAlias).toLowerCase();
  if (lowerStore.endsWith('debug.keystore') || lowerAlias.includes('debug')) {
    throw new Error('Debug keystore/alias is not allowed for signed release builds.');
  }

  env.NICE_RELEASE_STORE_FILE = normalizedStorePath;
  env.NICE_RELEASE_STORE_PASSWORD = storePassword;
  env.NICE_RELEASE_KEY_ALIAS = keyAlias;
  env.NICE_RELEASE_KEY_PASSWORD = keyPassword;
  return env;
}

function ensureReleaseDir() {
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }
}

function timestampForFile() {
  const date = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function patchCordovaFlatDirWarning() {
  const gradleFile = path.join(androidDir, 'capacitor-cordova-android-plugins', 'build.gradle');
  if (!fs.existsSync(gradleFile)) return;

  const source = fs.readFileSync(gradleFile, 'utf8');
  const legacyBlock = `flatDir{
        dirs 'src/main/libs', 'libs'
    }`;
  if (!source.includes(legacyBlock)) return;

  const replacement = `def localCordovaLibDirs = ['src/main/libs', 'libs'].findAll { dirPath ->
        file(dirPath).exists()
    }
    if (!localCordovaLibDirs.isEmpty()) {
        flatDir {
            dirs localCordovaLibDirs
        }
    }`;

  fs.writeFileSync(gradleFile, source.replace(legacyBlock, replacement));
  console.log('[Nice] Patched capacitor-cordova gradle to avoid flatDir warning when no local libs are present.');
}

function patchFilesystemKotlinConflict() {
  const gradleFile = path.join(root, 'node_modules', '@capacitor', 'filesystem', 'android', 'build.gradle');
  if (!fs.existsSync(gradleFile)) return;

  const source = fs.readFileSync(gradleFile, 'utf8');
  const legacy = "apply plugin: 'kotlin-android'";
  if (!source.includes(legacy)) return;

  const replacement = `if (project.extensions.findByName('kotlin') == null) {
    apply plugin: 'kotlin-android'
}`;
  fs.writeFileSync(gradleFile, source.replace(legacy, replacement));
  console.log('[Nice] Patched capacitor-filesystem gradle for built-in Kotlin compatibility.');
}

function removeDirIfExists(dirPath) {
  const wait = (ms) => {
    const start = Date.now();
    while ((Date.now() - start) < ms) {
      // Busy wait is acceptable here because this path only runs during release build maintenance.
    }
  };

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (!fs.existsSync(dirPath)) return;
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      if (!fs.existsSync(dirPath)) return;
    } catch {
      // Retry below.
    }
    wait(250 * attempt);
  }
}

function cleanupStaleGradleOutputs() {
  removeDirIfExists(path.join(androidDir, '.module-build'));
  const capacitorRoot = path.join(root, 'node_modules', '@capacitor');
  if (fs.existsSync(capacitorRoot)) {
    for (const entry of fs.readdirSync(capacitorRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginBuildDir = path.join(capacitorRoot, entry.name, 'android', 'build');
      removeDirIfExists(pluginBuildDir);
    }
  }
  removeDirIfExists(path.join(androidDir, 'capacitor-cordova-android-plugins', 'build'));
  removeDirIfExists(path.join(androidDir, 'app', 'build'));
}

function main() {
  const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const signingEnv = resolveSigningEnv();
  const isWindows = process.platform === 'win32';

  console.log('[Nice] Running release quality gate...');
  if (isWindows) {
    run('cmd', ['/c', 'npm', 'run', 'release:check']);
  } else {
    run('npm', ['run', 'release:check']);
  }

  console.log('[Nice] Syncing Capacitor Android project...');
  if (isWindows) {
    run('cmd', ['/c', 'npx', 'cap', 'sync', 'android']);
  } else {
    run('npx', ['cap', 'sync', 'android']);
  }
  patchCordovaFlatDirWarning();
  patchFilesystemKotlinConflict();
  if (isWindows) {
    run('cmd', ['/c', gradleCmd, '--stop'], { cwd: androidDir, env: signingEnv });
  } else {
    run(gradleCmd, ['--stop'], { cwd: androidDir, env: signingEnv });
  }
  cleanupStaleGradleOutputs();

  console.log('[Nice] Building signed release APK...');
  if (isWindows) {
    run('cmd', ['/c', gradleCmd, ':app:assembleRelease'], {
      cwd: androidDir,
      env: signingEnv,
      suppressPatterns: [/^Note:\s/i, /^w:\s/i],
    });
  } else {
    run(gradleCmd, [':app:assembleRelease'], {
      cwd: androidDir,
      env: signingEnv,
      suppressPatterns: [/^Note:\s/i, /^w:\s/i],
    });
  }

  if (!fs.existsSync(outputReleaseApk)) {
    throw new Error(`Release APK not found at ${outputReleaseApk}`);
  }

  ensureReleaseDir();
  const stampedName = `Nice-complete-signed-${timestampForFile()}.apk`;
  const destination = path.join(releaseDir, stampedName);
  fs.copyFileSync(outputReleaseApk, destination);

  console.log(`[Nice] Signed APK ready: ${destination}`);
}

try {
  main();
} catch (error) {
  console.error(`\n[Nice] build-signed-apk failed\n${error?.message || error}`);
  process.exit(1);
}
