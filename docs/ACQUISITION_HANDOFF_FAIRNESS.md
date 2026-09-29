# Fair admission to acquisition workers

Related #494 and #463. Worker claims already share durable turns per run/stage.
The bounded stage handoffs previously selected the oldest 32 eligible sources
globally, so a new batch could be absent from that fair claim queue during a
large historical refresh.

Recognition, image retrieval, catalog reconciliation and printing now share a
bounded handoff query. It ranks eligible source rows within each run, then admits
one head from each ready run before the next round of heads. Existing stage turns
break ties, followed by source FIFO. The total remains 32; a single eligible run
can still fill all 32 places.

Each stage retains its existing eligibility, owner/role, phase, receipt, revision,
photo and source/version fences. The helper does not claim jobs, alter priority,
change leases/retries, mutate evidence or reviews, or write Inventory. Recognition
models, confidence, image preparation and production settings remain unchanged.

The disposable database check tests all four stages with 64 older sources and
three newer sources, within-run FIFO, single-run throughput and the 32-row bound
across 40 runs. Run `npm run verify:acquisition -- --core` to execute it alongside
existing ownership/concurrency/recovery and production build checks.

Local Docker testing admitted all seven new photos under the existing historical
backlog; the first OCR job was created about 32 seconds after test start, versus
no OCR jobs after 4.5 minutes in the initial run. The unchanged ten-minute
full-batch printing gate still failed (four of seven results, initially one of
seven) while 13 active OCR runs shared the workers. Both failures and zero-write
fixture cleanup are retained. A separate three-original streaming review check
then passed through ordinary workers in 5.6 minutes: first-card suggestions in
about 83 seconds while the other cards were queued, preserved source/evidence,
desktop/phone review, correction/reload, zero Inventory writes and owned cleanup.
That test exercises incremental review, not completion of all printing checks.
Admission fairness does not establish recognition accuracy or sustained scanner
throughput; old work continues using the existing fair claim queue.
This PR is based independently on main. The
recognition/UI stack, including #493, is separate and is used cumulatively only
for local integration testing.
