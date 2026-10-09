# Unsaved scan correction status

Issue: https://github.com/sefaction/MTG-Archives/issues/694

Editing a saved scan review now shows **Unsaved correction** beside the current printing and attributes, and **Unsaved correction · save or cancel changes** in the card header. Restored browser drafts use the same status. An acknowledged save or cancelling changes restores the saved status; committed copies continue to show **Added to Inventory**.

The unchanged local application reproduced the defect: the stored review remained NM with its revision unchanged and no Inventory addition, while the displayed LP choice still said Review saved. The baseline failed the new unsaved-status assertion and cleaned its owned fixture. The baseline screenshot and JSON remain in the private local test artifacts.

Only two presentation labels change. Review persistence, recognition diagnostics, correction attribution, retention, sampling, permissions and explicit Inventory confirmation retain their existing behavior.

Qualification is pending: four actual API/browser cases at desktop and 320px phone widths cover printing/finish/condition changes, reload, cancel, acknowledged save, a reply lost after an actual server save, idempotent retry, and explicit Inventory commit with a stale browser draft. Existing affected workflow regressions, types, required-installer Docker build, source/native parity, service conservation and original-photo checks will be recorded after execution. These controlled presentation cases do not establish recognition accuracy or physical scanner acceptance.
