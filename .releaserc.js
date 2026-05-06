/**
 * semantic-release config — Linearr
 *
 * Default behavior: every releasable commit type produces a PATCH bump.
 * Override mechanisms:
 *   1. RELEASE_LEVEL env var (set by workflow_dispatch UI: patch | minor | major)
 *   2. Commit body marker: "release-as: minor" or "release-as: major"
 *      (parsed via the customRules array below)
 *
 * "release: false" types (docs, chore, style, test, build, ci) never trigger
 * a release on their own.
 */

const RELEASE_LEVEL = process.env.RELEASE_LEVEL || 'patch'
const VALID_LEVELS = ['patch', 'minor', 'major']
const level = VALID_LEVELS.includes(RELEASE_LEVEL) ? RELEASE_LEVEL : 'patch'

module.exports = {
  tagFormat: 'linearr-v${version}',
  branches: [
    'main',
    { name: 'release/*', prerelease: 'rc' },
  ],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          // Releasable types — all default to RELEASE_LEVEL (patch unless overridden)
          { type: 'feat', release: level },
          { type: 'fix', release: level },
          { type: 'perf', release: level },
          { type: 'refactor', release: level },

          // Hidden / non-releasable types
          { type: 'docs', release: false },
          { type: 'chore', release: false },
          { type: 'style', release: false },
          { type: 'test', release: false },
          { type: 'build', release: false },
          { type: 'ci', release: false },

          // Per-commit override — body containing "release-as: minor" or "release-as: major"
          { subject: '*release-as: minor*', release: 'minor' },
          { subject: '*release-as: major*', release: 'major' },

          // BREAKING CHANGE — patch by default (intentional: pre-1.0 stability).
          // Override with workflow_dispatch RELEASE_LEVEL=major when ready.
          { breaking: true, release: level },
        ],
        parserOpts: {
          noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE', 'BREAKING'],
        },
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          types: [
            { type: 'feat', section: 'Features' },
            { type: 'fix', section: 'Bug Fixes' },
            { type: 'perf', section: 'Performance' },
            { type: 'refactor', section: 'Refactoring' },
            { type: 'docs', hidden: true },
            { type: 'chore', hidden: true },
            { type: 'style', hidden: true },
            { type: 'test', hidden: true },
            { type: 'build', hidden: true },
            { type: 'ci', hidden: true },
          ],
        },
      },
    ],
    [
      '@semantic-release/changelog',
      { changelogFile: 'frontend/CHANGELOG.md' },
    ],
    [
      '@semantic-release/exec',
      {
        // Sync frontend/package.json version to match the computed release version
        prepareCmd:
          'cd frontend && npm version ${nextRelease.version} --no-git-tag-version --allow-same-version',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['frontend/package.json', 'frontend/CHANGELOG.md'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        successComment: false,
        failComment: false,
        labels: false,
        releasedLabels: false,
      },
    ],
  ],
}
