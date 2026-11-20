# Normal Unraid updates

Brian's November20 requirement is that the normal stop → pull/update → start
workflow must advance the application without editing image pins each release.

Normal installed image references use:

| Application role | Normal image |
| --- | --- |
| Web and services using the web image | `ghcr.io/sefaction/mtg-archives-web:main` |
| OCR recognition and model initializer | `ghcr.io/sefaction/mtg-archives-recognition:main` |
| Visual and printing workers | `ghcr.io/sefaction/mtg-archives-visual:main` |

These application services use `pull_policy: always`. Private `.env` values
`WEB_IMAGE`, `ACQUISITION_RECOGNITION_IMAGE`, `ACQUISITION_VISUAL_IMAGE` and
`IMAGE_TAG` must agree with that normal channel. Download the published release
before restarting; application migrations run through the normal web entrypoint.
Verify actual running image revisions after updating. Image availability and
source merge are distinct from the installed version.

Capture old immutable digests/image IDs in private recovery records before a
deployment. A temporary rollback can select those images explicitly; restore the
normal channel before calling the installation ready for ordinary updates.
Qualification must not silently leave release-specific digests or `sha-*` tags
in the active normal configuration.

## One-time repair of an older installed pin

The Portal activation selected immutable images in the installation's private
Compose Manager files. Pulling newer Git source did not replace that installed
copy, so stopping and updating still recreated c7872a24. This is the configuration
trap corrected here; no new environment setting, storage move or model rebuild
is needed to restore normal image updates.

On **Horoserve's Unraid terminal**, run the reviewed
[`scripts/repair-unraid-update-channel.sh`](../scripts/repair-unraid-update-channel.sh)
with `--apply`. The default `--check` validates candidate files without installing
them. The repair targets only
`/boot/config/plugins/compose.manager/projects/mtg-archives/compose.yaml` and its
private `.env`. It works with the application stopped as well as running.

It holds the existing exact-owner deployment lock, keeps private original copies,
normalizes recognized application image references and their pull policy, and
validates with Compose before installing. Credentials, mounts, model paths,
networks, profiles, commands and configured replica counts are preserved. Another
owner blocks the repair; a failed partial write restores the original files.
It creates no services or asset downloads and does not alter a live container,
scan, review, Inventory item or database. The short-lived parsing helper uses an
existing web image (pulling it if absent), with no network or application mounts.

After the repair, use the same usual stop → pull/update → start procedure. Keep
the operator's configured worker scale; one acquisition preparation replica is
the laptop default, while the production server retains its own settings. No
special repair script or manual image-hash edit is part of subsequent updates.

Changes that introduce future deployment requirements must ship a normal upgrade
path and disclose any exceptional prerequisite before asking Brian to update.
Never describe a successful source push as an installed production update.
