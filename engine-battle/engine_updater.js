/**
 * engine_updater.js — ChessGuru Monthly Engine Auto-Updater
 *
 * Runs on the 1st of every month via PM2 cron.
 * For every engine in engines.json:
 *   1. Checks latest GitHub release tag
 *   2. Compares to installed version
 *   3. Downloads + installs if newer
 *   4. Logs a monthly update report
 *   5. Discovers newly eligible engines from watch sources
 *
 * PM2 schedule: "0 3 1 * *"  (3am on 1st of each month, server time)
 * Run manually:  node engine_updater.js --force
 *                node engine_updater.js --engine stockfish17
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');

const ENGINES_JSON = path.join(__dirname, 'engines.json');
const ENGINES_DIR = path.join(process.env.HOME, 'engines');
const WEIGHTS_DIR = path.join(ENGINES_DIR, 'weights');
const LOG_DIR = path.join(__dirname, 'logs');
const REPORT_DIR = path.join(__dirname, 'reports');

const FORCE = process.argv.includes('--force');
const TARGET_ENGINE = process.argv.find(a => a.startsWith('--engine='))?.split('=')[1];

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_HEADERS = {
  'User-Agent': 'ChessGuru-Engine-Updater/1.0',
  'Accept': 'application/vnd.github.v3+json',
  ...(GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {})
};

const MAIA_WEIGHTS_BASE = 'https://github.com/CSSLab/maia-chess/raw/master/model_files';
const MAIA_ELO_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];

function ensureDirs() {
  for (const dir of [ENGINES_DIR, WEIGHTS_DIR, LOG_DIR, REPORT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOG_DIR, 'updater.log'), line + '\n');
}

function loadRegistry() {
  return JSON.parse(fs.readFileSync(ENGINES_JSON, 'utf8'));
}

function saveRegistry(registry) {
  registry.meta.lastUpdated = new Date().toISOString().split('T')[0];
  fs.writeFileSync(ENGINES_JSON, JSON.stringify(registry, null, 2));
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { ...GITHUB_HEADERS, ...headers } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function getLatestGithubRelease(repo) {
  try {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await httpsGet(url);
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    return { tag: data.tag_name, assets: data.assets, publishedAt: data.published_at };
  } catch (e) {
    log(`GitHub API error for ${repo}: ${e.message}`, 'WARN');
    return null;
  }
}

async function getSpecificGithubRelease(repo, tag) {
  try {
    const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
    const res = await httpsGet(url);
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    return { tag: data.tag_name, assets: data.assets, publishedAt: data.published_at };
  } catch (e) {
    log(`GitHub API error for ${repo} tag ${tag}: ${e.message}`, 'WARN');
    return null;
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const mod = url.startsWith('https') ? https : http;
    function get(u) {
      mod.get(u, { headers: GITHUB_HEADERS }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
      }).on('error', err => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    }
    get(url);
  });
}

function extractBinary(archivePath, engineId, destDir) {
  const ext = archivePath;
  try {
    if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz') || ext.endsWith('.tar')) {
      execSync(`tar -xzf "${archivePath}" -C "${destDir}" 2>/dev/null || tar -xf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
    } else if (ext.endsWith('.zip')) {
      execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'pipe' });
    }
    execSync(`find "${destDir}" -type f -name "${engineId}*" ! -name "*.json" ! -name "*.txt" ! -name "*.md" -exec chmod +x {} \\;`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    log(`Extraction error for ${engineId}: ${e.message}`, 'WARN');
    return false;
  }
}

async function installEngine(engine, release) {
  const destDir = ENGINES_DIR;
  const assetName = engine.releaseAsset;

  const asset = release.assets.find(a =>
    a.name.toLowerCase().includes((assetName || '').toLowerCase()) ||
    a.name.toLowerCase().includes('linux') ||
    a.name.toLowerCase().includes('ubuntu')
  );

  if (!asset) {
    log(`No matching asset found for ${engine.id} (looking for: ${assetName})`, 'WARN');
    log(`Available assets: ${release.assets.map(a => a.name).join(', ')}`, 'WARN');
    return false;
  }

  const tmpPath = path.join('/tmp', asset.name);
  log(`Downloading ${engine.name} ${release.tag} from ${asset.browser_download_url}`);

  try {
    await downloadFile(asset.browser_download_url, tmpPath);

    const isArchive = ['.tar.gz', '.tgz', '.zip', '.tar'].some(ext => tmpPath.endsWith(ext));
    if (isArchive) {
      extractBinary(tmpPath, engine.id, destDir);
    } else {
      const finalPath = path.join(destDir, engine.binary);
      fs.copyFileSync(tmpPath, finalPath);
      fs.chmodSync(finalPath, '755');
    }

    fs.unlinkSync(tmpPath);

    const enginePath = path.join(destDir, engine.binary);
    if (!fs.existsSync(enginePath)) {
      const found = execSync(`find "${destDir}" -maxdepth 2 -type f -name "${engine.binary}*" ! -name "*.so" ! -name "*.dll" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
      if (found) {
        const firstMatch = found.split('\n')[0];
        fs.copyFileSync(firstMatch, enginePath);
        fs.chmodSync(enginePath, '755');
      }
    }

    log(`Installed ${engine.name} ${release.tag} → ${enginePath}`);
    return true;
  } catch (e) {
    log(`Install failed for ${engine.id}: ${e.message}`, 'ERROR');
    return false;
  }
}

async function installMaiaWeights() {
  log('Checking Maia weights...');
  let updated = 0;
  for (const elo of MAIA_ELO_LEVELS) {
    const filename = `maia-${elo}.pb.gz`;
    const destPath = path.join(WEIGHTS_DIR, filename);
    if (fs.existsSync(destPath) && !FORCE) {
      log(`Maia ${elo} weight already installed`);
      continue;
    }
    const url = `${MAIA_WEIGHTS_BASE}/final-${elo}-40.pb.gz`;
    log(`Downloading Maia ${elo} weights...`);
    try {
      await downloadFile(url, destPath);
      log(`Maia ${elo} weights installed`);
      updated++;
    } catch (e) {
      log(`Maia ${elo} weights download failed: ${e.message}`, 'WARN');
    }
  }
  return updated;
}

function verifyEngine(engine) {
  const binaryPath = path.join(ENGINES_DIR, engine.binary);
  if (!fs.existsSync(binaryPath)) return false;
  try {
    const result = execSync(`echo "uci\nquit" | "${binaryPath}" 2>/dev/null | head -1`, {
      encoding: 'utf8', timeout: 5000, stdio: 'pipe'
    });
    return result.includes('id name') || result.includes('Stockfish') || result.includes('uciok') || result.length > 0;
  } catch (e) {
    return false;
  }
}

async function updateEngine(engine) {
  if (engine.type === 'maia') return { skipped: true, reason: 'maia (handled separately)' };
  if (!engine.githubRepo && !engine.directUrl) return { skipped: true, reason: 'no download source' };

  const binaryPath = path.join(ENGINES_DIR, engine.binary);
  const alreadyInstalled = fs.existsSync(binaryPath);

  let release = null;
  if (engine.githubRepo) {
    if (engine.releaseTag) {
      release = await getSpecificGithubRelease(engine.githubRepo, engine.releaseTag);
    } else {
      release = await getLatestGithubRelease(engine.githubRepo);
    }
  }

  if (!release) return { skipped: true, reason: 'no release found' };

  const isNew = !alreadyInstalled;
  const isUpdated = alreadyInstalled && engine.version !== release.tag;

  if (!isNew && !isUpdated && !FORCE) {
    return { skipped: true, reason: 'already current', version: engine.version };
  }

  const success = await installEngine(engine, release);
  if (success) {
    engine.installed = true;
    engine.version = release.tag;
    engine.installedAt = new Date().toISOString();
    return { updated: true, version: release.tag, wasNew: isNew };
  }
  return { failed: true, version: release.tag };
}

function buildMonthlyReport(results, month) {
  const installed = results.filter(r => r.result?.updated && r.result?.wasNew);
  const updated = results.filter(r => r.result?.updated && !r.result?.wasNew);
  const failed = results.filter(r => r.result?.failed);
  const skipped = results.filter(r => r.result?.skipped);

  const report = {
    month,
    generatedAt: new Date().toISOString(),
    summary: {
      totalEngines: results.length,
      newlyInstalled: installed.length,
      updated: updated.length,
      failed: failed.length,
      skipped: skipped.length
    },
    newlyInstalled: installed.map(r => ({ id: r.engine.id, name: r.engine.name, elo: r.engine.elo, version: r.result.version })),
    updated: updated.map(r => ({ id: r.engine.id, name: r.engine.name, version: r.result.version })),
    failed: failed.map(r => ({ id: r.engine.id, name: r.engine.name })),
    recommendations: []
  };

  const eloGroups = { '600-1100': 0, '1100-1900': 0, '1900-2500': 0, '2500-3000': 0, '3000+': 0 };
  for (const r of results) {
    const elo = r.engine.elo;
    if (elo < 1100) eloGroups['600-1100']++;
    else if (elo < 1900) eloGroups['1100-1900']++;
    else if (elo < 2500) eloGroups['1900-2500']++;
    else if (elo < 3000) eloGroups['2500-3000']++;
    else eloGroups['3000+']++;
  }
  report.eloDistribution = eloGroups;

  const minGroup = Object.entries(eloGroups).sort((a, b) => a[1] - b[1])[0];
  report.recommendations.push(`Elo band ${minGroup[0]} has fewest engines (${minGroup[1]}) — consider adding more`);

  return report;
}

async function discoverNewEngines(registry) {
  log('Checking EngineProgramming list for newly eligible engines...');
  try {
    const res = await httpsGet('https://raw.githubusercontent.com/EngineProgramming/engine-list/master/README.md');
    if (res.status !== 200) return [];

    const existingIds = new Set(registry.engines.map(e => e.id));
    const lines = res.body.split('\n');
    const newCandidates = [];

    for (const line of lines) {
      const match = line.match(/\[([^\]]+)\]\(https:\/\/github\.com\/([^)]+)\).*?(\d{4})/);
      if (match) {
        const name = match[1];
        const repo = match[2].replace(/\).*/, '');
        const elo = parseInt(match[3]);
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!existingIds.has(id) && elo > 2000) {
          newCandidates.push({ id, name, repo, elo });
        }
      }
    }

    if (newCandidates.length > 0) {
      log(`Found ${newCandidates.length} potentially new engines: ${newCandidates.map(c => c.name).join(', ')}`);
    }
    return newCandidates;
  } catch (e) {
    log(`Discovery failed: ${e.message}`, 'WARN');
    return [];
  }
}

async function main() {
  ensureDirs();
  const startTime = Date.now();
  const month = new Date().toISOString().slice(0, 7);

  log(`=== ChessGuru Engine Updater — ${month} ===`);
  log(`Mode: ${FORCE ? 'FORCE (reinstall all)' : 'normal (update only)'}`);
  if (TARGET_ENGINE) log(`Target: ${TARGET_ENGINE} only`);

  const registry = loadRegistry();
  let engines = registry.engines;
  if (TARGET_ENGINE) engines = engines.filter(e => e.id === TARGET_ENGINE);

  log(`Processing ${engines.length} engines...`);

  const maiaUpdated = await installMaiaWeights();
  log(`Maia weights: ${maiaUpdated} updated`);

  const results = [];
  for (const engine of engines) {
    log(`[${engine.id}] Checking ${engine.name} (Elo ~${engine.elo})...`);
    try {
      const result = await updateEngine(engine);
      results.push({ engine, result });
      if (result.updated) {
        log(`[${engine.id}] ${result.wasNew ? 'INSTALLED' : 'UPDATED'} → ${result.version}`);
      } else if (result.failed) {
        log(`[${engine.id}] FAILED`, 'ERROR');
      } else {
        log(`[${engine.id}] ${result.reason || 'skipped'}`);
      }
    } catch (e) {
      log(`[${engine.id}] Unexpected error: ${e.message}`, 'ERROR');
      results.push({ engine, result: { failed: true } });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const newEngines = await discoverNewEngines(registry);

  const report = buildMonthlyReport(results, month);
  report.newEngineCandidates = newEngines;
  report.maiaWeightsUpdated = maiaUpdated;
  report.durationMs = Date.now() - startTime;

  const reportPath = path.join(REPORT_DIR, `update-${month}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  saveRegistry(registry);

  log(`=== Update Complete ===`);
  log(`Installed: ${report.summary.newlyInstalled} | Updated: ${report.summary.updated} | Failed: ${report.summary.failed} | Skipped: ${report.summary.skipped}`);
  log(`Report saved: ${reportPath}`);

  if (report.summary.failed > 0) {
    log(`Failed engines: ${results.filter(r => r.result?.failed).map(r => r.engine.id).join(', ')}`, 'WARN');
  }

  if (newEngines.length > 0) {
    log(`New engine candidates found — review and add to engines.json: ${newEngines.map(e => e.name).join(', ')}`);
  }
}

main().catch(e => {
  log(`Fatal error: ${e.message}\n${e.stack}`, 'ERROR');
  process.exit(1);
});
