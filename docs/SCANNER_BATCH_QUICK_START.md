# Scanning cards in batches

Open the scanner helper and choose your saved website/account connection. On
**Imports → Scan cards**, use **fi-7160 (Cards, Pre-Pick Off)** and choose the
storage destination and section. Use comfortable small loads of card fronts and
stay beside the scanner when starting or resuming a load.

## Repeating a fixed count, such as 15 cards

1. Check **Set a batch limit** and enter **15** in **Cards in this batch**.
   The selected section must have enough available space. Load cards and Start.
2. If the hopper empties early, the batch keeps its saved cards and displays the
   number still needed. Refill, check the guides and clear transport, select the
   refill-readiness checkbox and use **Resume unfinished batch**.
3. Once the batch reaches 15, use **New scanner batch**. The chosen limit and
   destination are retained as preferences. Check the new available space and
   Start the next batch. Choose another section or adjust the limit if needed.

For example, ten saved fronts in a 15-card batch leave five still needed.
Resume adds those five to the same batch. The next batch begins with a fresh
count of zero and keeps your preferred limit of 15.

Clean counted runs use saved card-front images for progress. You do not need to
enter the exact number of cards that exited. If the scanner reports an error,
jam, interrupted transfer or uncertain result, keep the cards and originals and
follow the recovery instructions before starting another load.

## Filling storage sections

Leave the manual batch limit off and enable **Fill sections one at a time until
I stop**. Start the first section, then refill and **Resume unfinished batch**
as needed. The target accounts for stored cards and space already reserved by
pending batches.

When that section's target is reached, use **Choose next section**, select the
next section and Start its new batch. **Stop section series** ends the series
and keeps saved cards available for review. Selecting a new section, refreshing
or reconnecting does not start the scanner.

## Finding and closing out saved work

Use **Imports → Batches** to open the **Batch dashboard**. Pending shows batches
that still need attention; search by batch number or storage to find one.

| Total | Meaning |
| --- | --- |
| Saved cards | Card candidates retained in the batch |
| Evaluated | A current printing check or saved match review has completed |
| Assigned to storage | The batch has an available storage destination |
| Confirmed matches | Printing, finish, condition and language have been saved |
| Added to Inventory | Cards explicitly added, recorded in addition receipts |

Open a batch to review its matches and explicitly add the selected cards to
Inventory. Completing scanning does not add cards to Inventory.

**Cancel batch** stops image processing and keeps saved cards and reviews.
An accepted scanner load finishes saving; cancellation does not forcibly stop
the transport. **Resume processing** resumes image evaluation after settlement;
it does not scan cards or resume a stopped section series.

**Move to Trash** hides the batch and stops its processing. It remains
recoverable for seven days, then its saved scan files are deleted when cleanup
can run. Inventory additions and their receipts are kept. Restore is available
in the **Trash** view; an unfinished transfer returns to Cancelled until it is
settled and processing can explicitly resume.

The detailed [section/refill guide](SCANNER_SECTION_SERIES.md) and
[dashboard/Trash guide](ACQUISITION_BATCH_DASHBOARD.md) describe recovery and
capacity behavior. Current physical acceptance is recorded separately in the
[programmatic qualification](FI7160_PROGRAMMATIC_COUNT_CONTROL.md). The small
counts and section/refill sequence passed; the larger 83-card logical hardware
batch remains unfinished at 30 saved cards. That target is filled with small
refills, not an 83-card stack.
