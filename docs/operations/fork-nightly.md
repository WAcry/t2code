# Fork nightly releases

`WAcry/t3code` builds its desktop prereleases from a published upstream nightly and a reviewed commit of [PR #28845](https://github.com/pingdotgg/t3code/pull/28845). The PR head contains the six redesign layers. The release manifest records both source commits and the fork version. The release commit preserves the previous fork `main` as its first parent and records the upstream integration as its second parent.

## Prepare a candidate

Use Git 2.45 or newer, Node 24 or newer, and GitHub CLI from a checkout with the fork as `origin`. Review the PR head before adopting it. To reuse the already published PR commit, run `node scripts/prepare-fork-nightly.mjs --reuse-pr`.

```powershell
gh pr view 28845 --repo pingdotgg/t3code --json headRefOid --jq .headRefOid
$reviewedPr = Read-Host 'Enter the full SHA you reviewed'
node scripts/prepare-fork-nightly.mjs --pr $reviewedPr
```

The script selects the latest published upstream nightly with release assets. It creates a local `fork-nightly/<version>` branch and prints its SHA. Use `--upstream-tag v<upstream-version>` to select a specific published nightly after checking compatibility. Use `--revision <number>` to rebuild the same inputs with a new version or to avoid a version already used for a candidate.

If either merge conflicts, keep the existing release available and inspect the reported files. An explicitly selected older nightly should still be paired with a reviewed PR commit and pass the same build and checks before release. The script also stops if the fork overlay touches paths outside its allowlist. A deliberate new fork patch needs a corresponding allowlist review.

## Build and publish

Push the candidate branch and inspect the build for that exact commit in the fork’s [Actions runs](https://github.com/WAcry/t3code/actions). Download the `fork-nightly-release-assets` artifact and smoke-test the desktop build with a separate profile. Fast-forward `main` to the same commit once verification passes.

```powershell
$version = Read-Host 'Enter the fork version printed by the script'
$candidate = "fork-nightly/$version"
git push origin $candidate
```

```powershell
git push origin "${candidate}:main"
```

Dispatch the release workflow on `main` after it advances. Supply the successful candidate build run ID to publish the packages already verified for that commit.

```powershell
$buildRunId = Read-Host 'Enter the successful candidate build run ID'
gh workflow run fork-nightly.yml --repo WAcry/t3code --ref main -f publish=true -f "build_run_id=$buildRunId"
```

After the publish run succeeds, verify that `v<version>` identifies the candidate commit and the prerelease includes `SHA256SUMS` and the unsigned desktop packages for Windows, macOS, and Linux.

```powershell
gh release view "v$version" --repo WAcry/t3code
```

Install upgrades manually from the [fork's releases](https://github.com/WAcry/t3code/releases). Existing tags and releases are retained for rollback downloads.
