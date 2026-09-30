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

Destination and card input use two columns on desktop, with the detailed capacity
explanation folded. Acquisition overrides the shared picker's advisory-capacity
wording; other picker users retain their prior behavior. The continuation setup
keeps Start in the first1366x768 viewport in the controlled browser case. Phone
setup stacks normally; no page-wide overflow at320px.

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
START into an isolated fixture agent and owned cleanup. It seeds one owned
Inventory card to make capacity full, asserts no new Inventory commit, then
removes that seed. No helper or motor is
operated by this case.

The first database run exposed a fixture that accidentally copied its prior
manual quantity while expecting an unbounded target. The fixture now sends
quantity=null as the feeder UI does; the failure is retained privately. Test
definitions alone are not acceptance. The disposable acquisition/import rerun
passed with owned cleanup. The healthy loaded browser case passed1/1 in24.3s,
and source verification, typecheck/lint and both focused tests passed. Desktop/
320px setup images are captured by the fixture. After compacting, the final
case passed1/1 in23.1s, including the1366x768 Start bounds assertion; both images
were inspected. Final source490files and exact image/digest are in the checkpoint.

Larger-list interaction, physical USB/600DPI task acceptance, source-driver
isolation and public package/clean-host gates remain separate work. Recognition
accuracy and fi-7160 qualification are unchanged.
