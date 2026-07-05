#!/usr/bin/env node
/**
 * Build the SEALED release manifest for a Chronosphere GitHub Release.
 *
 * Run by the CI `seal` job (which `needs: [build]`, so it runs only after all three
 * platform builds have uploaded their assets) and uploaded to the release as
 * `manifest.json`. That asset is the authoritative "this release is complete"
 * sentinel AND the source of truth that the-real-antares.com mirrors: the box only
 * acts once manifest.json exists, and derives the site's version + filenames from it.
 * Also usable locally to backfill an already-published release.
 *
 *   node gen-release-manifest.mjs <tag>     # needs gh authed locally, or GH_TOKEN in CI
 *
 * Emits to stdout:
 *   { version, tag, publishedAt, assets: { win, macArm64, macX64, linuxAppImage, linuxDeb },
 *     files: [ { name, size, sha256 } ] }
 *
 * Aborts (non-zero) if any required installer role is missing or any asset lacks a
 * sha256 digest — so a half-uploaded or unverifiable release is never sealed.
 */
import { execFileSync } from 'node:child_process';

const tag = process.argv[2];
if (!tag) {
  console.error('usage: gen-release-manifest.mjs <tag>');
  process.exit(2);
}
const repo = process.env.GITHUB_REPOSITORY || 'the-real-antares/chronosphere';

const rel = JSON.parse(
  execFileSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }),
);
const assets = (rel.assets || []).filter((a) => a.state === 'uploaded');

// The five installer files the website serves, matched by STABLE filename suffix so
// the site never has to template or guess a versioned filename.
const ROLE_SUFFIX = {
  win: '-Setup.exe',
  macArm64: '-arm64.dmg',
  macX64: '-x64.dmg',
  linuxAppImage: '-x86_64.AppImage',
  linuxDeb: '-amd64.deb',
};
const roles = Object.fromEntries(
  Object.entries(ROLE_SUFFIX).map(([role, suf]) => {
    const a = assets.find((x) => x.name.endsWith(suf));
    return [role, a ? a.name : null];
  }),
);
const missing = Object.entries(roles)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`missing required installer role(s): ${missing.join(', ')}`);
  process.exit(1);
}

// Every asset (except the manifest itself) with its sha256 digest, so the mirror can
// verify each downloaded file — covers .dmg/.deb/.blockmap that the feeds never name.
const files = assets
  .filter((a) => a.name !== 'manifest.json')
  .map((a) => {
    const sha256 = String(a.digest || '').replace(/^sha256:/, '');
    if (!sha256) {
      console.error(`asset ${a.name} has no sha256 digest — refusing to seal`);
      process.exit(1);
    }
    return { name: a.name, size: a.size, sha256 };
  });

const manifest = {
  version: tag.replace(/^v/, ''),
  tag,
  publishedAt: rel.published_at,
  assets: roles,
  files,
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
