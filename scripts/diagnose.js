#!/usr/bin/env node
/**
 * diagnose.js — collects Metro/logcat/tsc errors and writes BUG_REPORT.md
 * Usage: npm run diagnose
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

const lines = [];
const ts = new Date().toISOString();

function run(cmd, label) {
  lines.push(`\n## ${label}\n\`\`\``);
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
    lines.push(out.trim() || '(no output)');
  } catch (e) {
    lines.push((e.stdout || '') + (e.stderr || '') || e.message);
  }
  lines.push('```');
}

lines.push(`# BUG_REPORT — ${ts}\n`);
lines.push(`**Commit:** ${execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()}`);
lines.push(`**Branch:** ${execSync('git branch --show-current', { encoding: 'utf8' }).trim()}\n`);

// TypeScript errors
run('npx tsc --noEmit 2>&1 | head -80', 'TypeScript errors');

// ESLint
run('npm run lint -- --max-warnings 0 2>&1 | tail -50', 'ESLint');

// Last Metro log (if exists)
const metroLog = 'metro.log';
if (fs.existsSync(metroLog)) {
  lines.push('\n## Metro log (last 60 lines)\n```');
  const content = fs.readFileSync(metroLog, 'utf8').split('\n').slice(-60).join('\n');
  lines.push(content);
  lines.push('```');
}

// ADB logcat — last 100 crash lines
run('adb logcat -d -s ReactNativeJS:E AndroidRuntime:E *:F 2>&1 | tail -100', 'ADB crash log');

const report = lines.join('\n');
fs.writeFileSync('BUG_REPORT.md', report, 'utf8');
console.log('✅ BUG_REPORT.md written — share with Claude or Codex to diagnose.');
