# Correction-library containing-directory durability

Related to existing #305 and #310; both retain their broader acceptance scope.

A correction original lives under the provisioned upload root,
`correction-library-v1`, and an owner-hash directory. Confirming the file and
owner directory alone does not confirm the two containing directory entries.
Initial publication and existing-file verification now confirm all three
directories before preservation accounting or source-pin release.

Every directory barrier is attempted independently. Failures retain their
order, original primary cause and storage code, including falsy causes. The
worker classifies an otherwise unknown cause as a recoverable copy failure.
Integrity checks precede these barriers; immutable bytes, reservations,
ownership, maintenance/backup guards and Windows behavior remain protected.
The configured upload mount's own provisioning and physical power-loss
qualification are separate requirements.

The pre-transfer #984 qualification, failed controls and original author's
checkpoint are preserved in the
[prior source-bound record](https://github.com/sefaction/MTG-Archives/blob/cd4191aaf05a201be737c423fe148efd8d87b07d/docs/WORK_CHECKPOINT.md)
and the PR's dated history. Main's shared checkpoint is retained unchanged in
this branch; current transient owner/runtime details stay in the task's private
checkpoint. Earlier passes do not substitute for qualification of this change.

The resolving PR records current-head regression, SQL, affected product workflow
and source/runtime evidence, including failed attempts and limits. Controlled
directory errors do not establish natural storage failure, data loss, physical
power-loss behavior, production deployment or user acceptance.
