# Continuous scanner batches

Part of workflow audit #506, following #525. New scanner batch links to an
account-authorized, settled previous run. The server offers its location/section,
reported source identity, requested settings and batch defaults as a preference
for the new setup form. No image, candidate, review, receipt, count, capacity or
run identity is copied. Nothing starts on navigation.

The page resolves the suggested location against freshly scoped active locations.
A missing location requires a new choice; a missing section clears that section
with guidance. A foreign or unsettled run supplies no suggestions. An offline
previous source stays explicitly unavailable, without silently choosing a
different scanner; it can become selectable when its helper reports it online.
The ordinary source selection and explicit Start remain authoritative.

Refresh capacity re-renders current scoped location/occupancy data while retaining
form choices. A full or missing destination disables Start. Displayed room includes
stored Inventory; pending batches, layout, owner and capacity are rechecked by
existing server creation, native claim and final Inventory gates. No pre-scan
manual count or exact stop promise is added.

New batch defaults are validated by the existing review schema and stored with
session creation. Default creation without supplied values keeps nonfoil/NM.
Changed defaults under a reused request identity still fail replay validation.
The new batch's reviews/overrides and explicit Inventory commit work normally.

## Evidence scope

Focused tests cover current-location/removed-section preference resolution.
Disposable database checks cover unsettled/foreign denial, preserved settings and
defaults, fresh identity/empty acquisition state, new target computation and
changed-default replay rejection. The local browser case covers cancel-to-next,
source/destination/default retention, refreshed zero/one capacity, explicit new
START into an isolated fixture agent and owned cleanup. No helper or motor is
operated by this case.

The first database run exposed a fixture that accidentally copied its prior
manual quantity while expecting an unbounded target. The fixture now sends
quantity=null as the feeder UI does; the failure is retained privately. Test
definitions alone are not acceptance; results are in the PR/checkpoint.

Larger-list interaction, physical USB/600DPI task acceptance, source-driver
isolation and public package/clean-host gates remain separate work. Recognition
accuracy and fi-7160 qualification are unchanged.
