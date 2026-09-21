# UI consolidation: first design review

Related: [#262](https://github.com/sefaction/MTG-Archives/issues/262), [#263](https://github.com/sefaction/MTG-Archives/issues/263), [#274](https://github.com/sefaction/MTG-Archives/issues/274).

The user started the design phase on 2026-09-21 after reviewing the roadmap. This batch proposes navigation and Inventory/Locations layouts. It does not implement a replacement application shell or resolve the existing reliability defects. Source baseline: `7a32dd3f1f1c11565310cc18366866cc26dc4906`.

## Review locally

```powershell
docker compose -p mtg-archives-design -f docker-compose.design.yml up -d --pull never
```

Open **http://127.0.0.1:13002**. The existing application remains at http://127.0.0.1:13001. The preview is a separate Docker project with a read-only design-directory mount, no application network, no database, no credentials and no API calls. It uses the already installed `node:22-alpine` image. Only four named static assets are served; other paths and non-GET requests return 404. The review bar is prototype tooling, not a proposed product setting.

Stop only this preview with `docker compose -p mtg-archives-design -f docker-compose.design.yml stop`. The preview needs no build; the mounted files reflect the checked-out design branch. Changes in this batch comprise design documents, a synthetic prototype, its checks and a checkpoint. No app source, schema or current app image changed.

## What to try

1. Compare **A · Sidebar** and **B · Top navigation**, keeping Inventory/Locations/Decks one click away. The sidebar is the recommended starting point: predictable grouped destinations and a separate utility area. Its tradeoff is 170–190 pixels of table width. Top navigation gives that width back but consumes another row and wraps more readily as labels grow.
2. Search for `Counterspell`, open Filters, apply `Nonfoil`, then remove the name chip. Results stay alongside filters on desktop; the phone filter form closes on Apply. Opening details and cancelling a move preserve filters and selection.
3. Reset. Select **Sol Ring (8)** and **Arcane Signet (9)** with checkboxes or Ctrl-click. Choose **Move copies**, **Sect 1**, and **Fill remaining space**. The review projects **68 → 85**, and **Simulate move** updates both the sample placements and occupancy. Try Sect 3 to see advisory overflow. Changing sections recalculates the projection and Fill shortcut.
4. Open **Locations**. All six sections remain in one row; phones scroll only that tray. Select a section to open exact-section Inventory. Unsectioned and nondefault Sect 10 remain visible. Search the location tree by a full path. Reset restores all synthetic data.

Other destinations and rare actions open named design notes, not fake completed workflows. View options, the complete filter set, generalized destination search, persistent URLs for criteria, edit/split/export/import, administration and role variants are mapped but are not functional simulations. The preview simulates only unreserved copies; it is not a replacement transaction implementation or proof of server safety.

## Proposed workspace contract

- Compact page identity and scope; one primary action. Collection tools occupy one search/results workspace. Avoid explanatory banners before ordinary content.
- Sidebar groups Collection, Build & exchange, and Explore. On phones, one labelled Menu exposes every destination. Commander League stays an explicit separate-workspace entry. Account & settings groups existing utility routes without removing their URLs; administration retains deliberate mode entry and a persistent mode indicator.
- Inventory: search and active chips above results; ordinary filters first in a side panel, expression syntax under an explicitly labelled advanced disclosure. A compact panel on narrow screens; Apply returns users to results. One View options home retains all current view/display/page/column controls.
- Show selection actions only with a selection. Always distinguish entries from physical copies and explicit selection from all-matching. Selection outside visible filters must be disclosed. Grouped mode retains its existing bulk-edit restrictions. Preserve loaded-row-only Shift range and touch checkboxes.
- Move review combines destination, section occupancy, quantity and final review. Capacity remains advisory. Production must retain transaction validation, reservations, same-section accounting, source identity/provenance, stale-state handling and refresh completion.
- Locations opens on searchable storage and selected-location detail. Creation and type/whole-location maintenance become contextual entry points. Deck-managed locations retain a named secondary home and their restrictions.
- Card detail remains close to results. This prototype uses an accessible native dialog; an adjacent detail panel is a later design option, not a decision. Preserve all faces, related cards, metadata, per-stack placements, history and capability-gated actions.
- Error/empty/loading states stay within their workspace. Failed actions preserve inputs/selection; successful movement announces exact quantities and refreshes source/destination. Do not use optimistic counts as evidence that a transaction succeeded. #220/#260 remain separate gates.

## Visual tokens and accessibility contract

This is a wireframe with the existing six theme identities, not a final art direction. Prototype palettes are derived from `app/globals.css`; production must reuse `--app-*` variables rather than introduce another theme system. Use existing strong borders for interactive boundaries, text/muted/link roles, a contrasting focus ring and labelled status messages. The review uses Izzet by default and exposes Golgari, Azorius, Selesnya, Rakdos and Lotus for comparison.

Proposed spacing scale: 4/8/12/16/24/32 px. Body 14 px, metadata 12 px, compact page title 26–28 px, controls at least 38 px desktop / 44 px phone. Editable phone fields are 16 px. Reserve 11 px uppercase labels for nonessential grouping only. Keep theme accent text distinct from destructive/advisory states; color is never the only signal. Production contrast is a gate, not implied by copying old palette tokens.

Keyboard: native controls, visible focus, labelled dialogs, Escape/cancel and return to the invoking control. Tables may scroll locally; avoid whole-page overflow. The prototype intentionally uses a nonsticky selection bar while the layout is under review; sticky behavior needs separate focus-obscuring tests with long selections. At 320 px, buttons wrap and the six-section tray remains local. Browser Back/Forward restores the prototype screen only; production must preserve full filter/page/return context and all existing deep links.

## Decisions for this review

Recommend **A · Sidebar**, browse-first Locations and side-by-side filters/results on desktop. The user has authorized producing this design batch; the layout direction is still proposed. Review these wireframes before implementing the shared shell and Inventory/Locations pilot. Individual PR merge approval remains separate.

Acceptance evidence and open work: [ACCEPTANCE.md](ACCEPTANCE.md). All current page routes, grouped actions and permission differences: [CAPABILITIES.md](CAPABILITIES.md). Neither issue #263 nor #274 is complete from this prototype alone.
