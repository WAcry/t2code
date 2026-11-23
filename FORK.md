# Fork nightly releases

`WAcry/t3code` builds its desktop prereleases from a published upstream nightly and a pinned commit of the six-layer redesign stack in PR #28845. The [release manifest](.github/fork-nightly.json) records both source commits and the GitHub release tag. The release commit preserves the previous fork `main` as its first parent and records the exact upstream integration as its second parent. [Upstream releases](https://github.com/pingdotgg/t3code/releases) · [PR #28845](https://github.com/pingdotgg/t3code/pull/28845)

The desktop app uses the upstream nightly's version, app identity, data directories, and update feed. The GitHub release tag adds `-pr28845.<revision>` so the same nightly can be rebuilt with a newer PR commit.

## Track the three sources

- Track upstream `main` with `git fetch --no-tags upstream main`. If the clone lacks an upstream remote, add it with `git remote add upstream https://github.com/pingdotgg/t3code.git`. Use this ref to inspect upcoming changes. Fork releases take their base from a published nightly tag with assets.
- Prefer the latest published nightly. The candidate script merges the pinned stack against that tag from scratch, so it also picks up upstream changes that were already present in fork history but absent from the previous release tree.
- Check the PR's current head and status before changing the pin. Review the [PR](https://github.com/pingdotgg/t3code/pull/28845) and compare the pinned SHA to the proposed head. If the head moved since review, rerun the review or use `--reuse-pr`. Once the redesign lands upstream, verify that a published nightly includes it and retire the stack pin and any superseded fork fixes.

## Prepare a candidate

Use Git 2.45 or newer, Node 24 or newer, and GitHub CLI from a checkout with the fork as `origin`. Review the PR head before adopting it. To reuse the already published PR commit, run `node scripts/prepare-fork-nightly.mjs --reuse-pr`.

```powershell
gh pr view 28845 --repo pingdotgg/t3code --json headRefOid --jq .headRefOid
$reviewedPr = Read-Host 'Enter the full SHA you reviewed'
node scripts/prepare-fork-nightly.mjs --pr $reviewedPr
```

The script selects the latest published upstream nightly with release assets. It creates a local `fork-nightly/<release-tag>` branch and prints its SHA. Use `--upstream-tag v<upstream-version>` to select a specific published nightly after checking compatibility. Use `--revision <number>` to rebuild the same inputs under a new tag.

If either merge conflicts, keep the existing release available and inspect the reported files. An explicitly selected older nightly should still be paired with a reviewed PR commit and pass the same build and checks before release. The script also stops if the fork overlay touches paths outside its allowlist. A deliberate new fork patch needs a corresponding allowlist review.

## Build and publish

Push the candidate branch and inspect the build for that exact commit. The workflow runs the layout tests and validates the desktop packages. Fast-forward `main` to the same commit once verification passes. [Actions runs](https://github.com/WAcry/t3code/actions)

```powershell
$releaseTag = Read-Host 'Enter the release tag printed by the script'
$candidate = "fork-nightly/$releaseTag"
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

After the publish run succeeds, verify that the tag identifies the candidate commit and the prerelease includes `SHA256SUMS` and desktop packages for Windows, Linux, and Intel macOS.

```powershell
gh release view $releaseTag --repo WAcry/t3code
```

Download builds with the redesign from the fork's releases. In-app updates follow the official nightly feed. [Fork releases](https://github.com/WAcry/t3code/releases)
