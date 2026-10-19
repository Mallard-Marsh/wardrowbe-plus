# wardrowbe-plus build plan

Updated 2026-10-19. Fork: https://github.com/Mallard-Marsh/wardrowbe-plus, cloned at `~/claude code/wardrowbe-plus` with remotes `origin` (your fork) and `upstream` (Anyesh). Running on Vault as `1.11.0-plus.2`.

This file covers the **features still to build**. How the fork is built, deployed and rolled back is in [Reference](#reference) at the bottom.

---

## 1. Where we are

**Done and live on Vault**
- A. English (UK) locale ([PR #1](https://github.com/Mallard-Marsh/wardrowbe-plus/pull/1))
- Account language now follows the account on new devices ([PR #2](https://github.com/Mallard-Marsh/wardrowbe-plus/pull/2))
- Type names filed as subtypes are promoted, e.g. shoes › sneakers → Trainers ([PR #3](https://github.com/Mallard-Marsh/wardrowbe-plus/pull/3))

**Asked upstream, no maintainer reply yet:** [#269](https://github.com/Anyesh/wardrowbe/issues/269) en-GB, [#270](https://github.com/Anyesh/wardrowbe/issues/270) editable tags, [#284](https://github.com/Anyesh/wardrowbe/issues/284) splitting multi-garment photos. Drafts for the other three are in [github-issues/](github-issues/README.md).

**Still to build** (sizes: S = one sitting, M = a couple, L = several)

| Step | Feature | Size | DB migration | Needs first | Upstream route |
|---|---|---|---|---|---|
| 1 | **F** Background removal for single items runs in the image worker and frees its memory | S | No | none | PR |
| 2 | **C1** AI photo size setting (sharper tagging) | S | No | none | issue draft 2, then PR |
| 3 | **B** Editable AI tags + primary/secondary/tertiary colours | M | No | none | issue #270, then PR |
| 4 | **C2** "Re-analyse and replace" | M | No | B | with C1 |
| 5 | **H** Split photos with several garments (on demand first, then in bulk upload) | L | No | C1 | issue #284, then PR |
| 6 | **D** Brand and size from labels | M | No | C1 | issue draft 3, then PR |
| 7 | **G** Log an outfit from a photo of me | M–L | No | H, C1 | discuss first |
| 8 | **E** Flat-lay outfit image | M–L | No (v1) | none (nicer after upstream #278) | issue draft 4 |

**Why this order**
- **F first.** It's small, has no screens, and it's the one change that helps Vault's tight memory.
- **C1 next.** One setting that makes every later vision feature (splitting, labels, outfit photos) more accurate.
- **B before the rest.** You asked for editable tags first, and it gives C2 the "which tags did the user edit" record it needs.
- **H before G.** Both need to find garments in a photo, so the finder is built once, in H.
- **E last.** It's the biggest design call, and upstream is changing background removal under it (#278).

---

## 2. Ground rules for every feature

- **Branch and PR rhythm.** Branch from `upstream/main` → PR into `plus` (review the diff, CI runs) → merge → Docker Publish `1.11.0-plus.N` → back up → deploy → use it for a few days → upstream PR from the same branch.
- **Keep changes out of the crowded files.** `item-detail-dialog.tsx` (1,119 lines), `add-item-dialog.tsx`, `api/items.py` and `upload-manager.ts` are being changed by upstream PRs #228, #283 and #277 right now, and will conflict. Put new code in **new files** and touch those four with only a few lines (an import and a mount point).
- **No database migrations.** They make going back to the official images hard. Everything below uses existing columns, the `tags` JSON, or file naming. Use `tags` JSON keys the AI never writes, like the existing `size` and `care_instructions`.
- **Translations.** Every new screen string goes through `next-intl` in all 8 locales (plus an ICU plural where a count appears). `en-GB` is generated: run `npm run i18n:en-gb` after changing `en`, because `i18n:check` fails while it's stale.
- **Checks before every push:** `ruff check`, `ruff format --check`, `pytest`, `npm run lint`, `npm test`, `npm run i18n:check`, `npm run vocab:check`, `npm run build`. CI runs the same set on every PR.
- **Test on your phone.** You use the app on iPhone Safari over the LAN, so anything with touch (the split screen, the outfit-photo screen) gets a real-phone check. I can test desktop and a phone-sized window here; you confirm on the device.
- **Deploy routine:** database dump first (`docker compose exec db-backup sh /db-backup.sh now`), then bump `WARDROWBE_VERSION`, `chmod 600 .env`, `pull`, `up -d`, `alembic upgrade head`, health check, try the feature on real data.
- **Cost watch.** Each vision feature reports its token use in the logs. Budget: a few pence per photo at most.

---

## 3. Shared pieces (build once, reuse)

| Piece | Built in | Reused by | What it is |
|---|---|---|---|
| `user_edited_keys` | B | C2 | A list inside the item's `tags` JSON of the tag keys you've edited by hand. |
| Garment finder | H | G | `services/garment_detector.py` with prompt `prompts/garment_detection.txt`. Returns each visible garment with a box (0–1 coordinates), a type and colours. Validates and clamps boxes, drops tiny or inverted ones, caps at 8. |
| Crop helper | H | G | Crops a box out of the stored full-size photo. It applies the same EXIF rotation the app uses when storing photos, so boxes line up. |
| Larger AI photos | C1 | H, D, G | `AI_IMAGE_MAX_SIZE` setting. |

---

## 4. Step 1: F, single-item background removal in the image worker

**Goal:** removing a background no longer fills the web backend's memory.

**What the code does today**
- `POST /items/{id}/remove-background` runs the removal inside the API process (`asyncio.to_thread`).
- `get_provider()` in `services/background_removal.py` keeps the loaded model in a module-level variable, so the **~1.4 GB model stays in memory until the container restarts**. Vault showed this on 18 Oct: backend 1.5 GB, then 115 MB after a restart.
- The bulk action already queues the job on the image worker.

**A correction to my earlier plan:** I said moving the job to the worker would be "a big RAM win". It isn't on its own. The worker caches the model the same way, so the 1.4 GB would just move there. The win needs the model **released after use**.

**Plan**
1. The single-item endpoint enqueues `remove_item_background_job`, like the bulk path, and returns the item in `processing` state. Check that the item screens refresh while an item is processing (the bulk path relies on it).
2. New setting `BG_REMOVAL_RELEASE_MODEL` (default off, so upstream behaviour is unchanged). When on, the image worker drops the model and runs garbage collection after each job. Cost: a few seconds to reload per photo. Measure it on Vault.
3. In your compose file only: `mem_limit: 2g` on `image-worker`, so a spike can't squeeze the Home Assistant VM.
4. Measure with `docker stats` before and after one removal. Targets: backend stays near 100–200 MB, image worker falls back near 100 MB between jobs.

**Tests:** endpoint enqueues and returns processing (Redis mocked); the job releases the model only when the setting is on; existing background-removal tests still pass.

**Overlap:** upstream #277 changes the same job (adds `then_tag_path`) and #278 makes `birefnet-general-lite` the default model, which is heavier. Your `.env` pins `BG_REMOVAL_MODEL=u2net`, so you're not affected. Keep the release setting compatible with both.

---

## 5. Step 2: C1, AI photo size

**Goal:** the AI sees more of each photo, so patterns like herringbone, textures and small colours stop being missed.

**Today:** `AIService._preprocess_image` shrinks every photo to 512px and saves it at JPEG quality 85, fixed.

**Plan**
1. Settings `AI_IMAGE_MAX_SIZE` (default 512, allowed 256–2048) and `AI_IMAGE_QUALITY` (default 85). Defaults stay the same, so it's safe for upstream.
2. Document both in `.env.example` and the README environment table.
3. Vault: set `AI_IMAGE_MAX_SIZE=1024`. In the Phase 2 key test, a 1024px photo cost about 1,300 input tokens on gpt-4.1-mini, a fraction of a penny.

**Tests:** resize respects the setting and leaves smaller photos alone; out-of-range values are rejected or clamped.

**Vault check:** re-analyse the grey herringbone blazer, which was tagged "solid" at 512px. Record before and after.

---

## 6. Step 3: B, editable AI tags and ordered colours

**Goal:** fix any tag on screen, and give each item a primary, secondary and tertiary colour.

**What the code does today**
- The backend already accepts `tags`, `colors` and `primary_color` on update, merging tag keys under a row lock.
- Re-analysis never overwrites a non-empty value, so your edits survive.
- The edit screen only covers name, type, subtype, brand, primary colour, notes, wash interval and favourite.
- Labels for patterns, styles, seasons and fits already exist in all locales (`constants.*`), so only the new screen's own text needs translating.
- Pattern, style, season and fit lists live in `ai_service.py`, not in the shared vocabulary file, so the frontend can't build dropdowns from them.
- **Recommendations:** the AI prompt text already lists *all* of an item's colours. The ranking score (`item_scorer.py`) only looks at `primary_color` for favourite and avoid colours.

**Plan**
1. Move the pattern, style, season and fit lists into `backend/app/data/garment_vocabulary.json`, derive the backend lists from it, and run `npm run vocab:gen`.
2. Backend validation on update: reject unknown values (422), but **only for keys being changed**, so older items holding off-list values can still be saved.
3. When you change a tag by hand, add its key to `tags.user_edited_keys`.
4. When you change the **type**, clear a subtype that doesn't belong to the new type. This also stops contradictions like "T-Shirt • Button-down" that a re-analysis can create.
5. New file `components/item-tags-editor.tsx`, mounted in the item dialog with only a few lines changed there:
   - selects for pattern, material, formality, fit
   - chips for style and season
   - a colour list you can add to, remove from and reorder: first = primary (kept in step with `primary_color`), second = secondary, third = tertiary
   - it sends only the keys you changed
6. `item_scorer.py`: check favourite and avoid colours against every colour on the item, not only the primary. Small change.

**Tests:** pytest for validation (changed vs unchanged keys, type-change clears subtype); vitest for the editor sending only changed keys and for colour reordering; scorer test with a secondary colour.

**Vault check:** set the blazer to herringbone and add a secondary colour, press Re-analyse, and confirm your edits stay.

---

## 7. Step 4: C2, "Re-analyse and replace"

**Goal:** after C1, re-run the AI on existing items and let it replace its earlier guesses without touching what you edited.

**Today:** re-analysis only fills empty fields, so improved tagging never reaches items that already have values.

**Plan**
1. `POST /items/{id}/analyze?replace=true` and a button "Re-analyse and replace AI tags". Pass `replace` to `tag_item_image` as an extra argument.
2. In replace mode, each tag the AI returns overwrites the stored one **unless its key is in `user_edited_keys`**. Keep the tag columns (type, subtype, primary colour and so on) and the `tags` JSON in step, as the worker already does.
3. A confirm box says what will happen: "Replaces AI tags. Anything you've edited since editing was added is kept." **Edits made before B shipped aren't recorded**, so the box must say so.
4. Follow-up: the same option on the bulk "Analyse" action for selected items.

**Tests:** replace mode skips edited keys, replaces the rest and keeps columns and JSON consistent; the default mode is unchanged.

---

## 8. Step 5: H, split photos with several garments ([#284](https://github.com/Anyesh/wardrowbe/issues/284))

**Goal:** a photo with several garments becomes several items. Nothing is created from a guess: you confirm first.

**What the code does today** (traced on 19 Oct, with your three-tops photo)
- `bulk_create_items` makes one item and one tagging job per file.
- The tagging prompt asks for the "MAIN" garment and one answer, so three tops got blended into one item.
- `ImageService.process_and_store` already handles HEIC and EXIF rotation, and `ItemService.create` plus `tag_item_image` already create and tag items. Splitting reuses all three.
- The wardrobe already has an archive action with a reason, which is reversible.
- No image-cropping library is installed.

**Phase 1: on demand, no changes to upload code**
1. Garment finder (shared piece, section 3): `POST /items/{id}/detect-garments`. It writes nothing and returns boxes, a type guess and colours for each garment. Rate-limited, one vision call at the C1 size.
2. `POST /items/{id}/split` takes the confirmed boxes and, for each, crops the stored full-size photo into a new item, queued for normal tagging. It then **archives the source item** with reason `split`, so you can restore it. This avoids deleting anything.
3. **The duplicate check must be skipped for these crops.** Upload rejects photos that look like an existing one (perceptual-hash distance ≤ 8). Crops of a plain white and a cream tee could look identical to that check. Your photo is exactly this case, so test it.
4. New file `components/split-photo-dialog.tsx`: the photo with draggable and resizable boxes drawn over it as percentages. Plain pointer events (works for touch), no new library. Controls: remove a box, add a box, "Create N items".
5. A "Split photo" button in the item dialog, plus a banner when the AI description mentions several garments or the AI reports more than one garment. A few lines in the existing dialog.

**Phase 2: bulk upload**
6. A checkbox in the upload dialog, "My photos may contain several garments", off by default. When on, detection runs per photo after upload and flagged items appear in a "Needs review" list. Do this **after** upstream #277 and #283 settle, since they rewrite the same dialog and `upload-manager.ts`.
7. When more than one garment is found, don't store the blended tags: leave the item "needs review" until split or dismissed.

**Tests:** finder parser (clamping, tiny and inverted boxes dropped, cap at 8); crop helper (rotated photos, edges); endpoint tests with the AI mocked (N items created, source archived, duplicates not blocked); vitest for the box maths (resize, clamp, percentage ↔ pixels); a real run with your three-tops photo and about 10 other multi-item photos, recording how many boxes were right.

**Risks**
- Vision-model boxes are approximate with overlapping hangers, so adjustment must be easy. If boxes are poor with `gpt-4.1-mini`, try `gpt-4o` for detection only.
- Touch dragging on iPhone needs real-device testing.

---

## 9. Step 6: D, brand and size from labels

**Goal:** read brand, size and fabric from visible labels, and put them in the AI summary.

**What the code does today**
- `analyze_image` sends one image. Up to 4 additional photos per item already exist (`ItemImage`) but the AI never sees them.
- The tags already have user-owned `size` and `care_instructions` keys. `brand` is a column. Upstream #228 (open) adds the screens for size, store and care, with a migration.

**Plan**
1. Prompt: optional `brand`, `size` and `fabric_composition`, "null unless clearly legible on a label, never guess". Validate lengths and strip anything that looks like a sentence.
2. Send up to 2 additional photos alongside the main one, resized with the C1 setting, so a label close-up can be used.
3. The tagging worker fills `brand` and `tags.size` only if empty. Never overwrite what you've set.
4. The description prompt mentions brand and size when found. This is the part you'll see immediately.
5. **No size screen from us.** #228 already builds one. Until it lands, size appears in the AI summary only.
6. Tests: parser tests including junk and guessed values dropped; worker fill-only-if-empty; token-cost log line.

**Vault check:** photograph a care label close-up as an additional photo on one real item.

**Overlap:** #283 adds front/back/detail views for photos. A "label" view would fit it naturally, so look again at #283 before building.

---

## 10. Step 7: G, log an outfit from a photo of me

**Goal:** a photo of you wearing an outfit finds the matching items in your wardrobe, you confirm, and it logs the outfit as worn today.

**Updated findings**
- `POST /outfits/studio` already takes `mark_worn: true`. It creates the outfit, sets it to today and records the wear on each item (`record_wears`), so wear counts, wash reminders and learning update in **one call**. No separate "wear today" step is needed.
- The garment finder and crop helper come from H, so unmatched garments can become items from a **real crop** instead of the whole photo.

**Plan**
1. `POST /outfits/from-photo` (writes nothing): finder → for each garment, shortlist wardrobe items by type family, colour and pattern (code, no AI) → one vision call with the photo plus the shortlist's thumbnails, numbered, returning a pick or `none` with a confidence.
2. New `components/outfits/log-from-photo-dialog.tsx` and a button on the Outfits page: photo on one side, a row per garment (matched thumbnail, "Change" using the existing item picker, "Not this", "Skip"), "Add as new item" for unmatched ones using the crop, and a manual "add a hidden item" for layers it can't see.
3. "Log outfit" calls `POST /outfits/studio` with the confirmed items and `mark_worn: true`.
4. **The selfie isn't kept by default.** There is a clear notice that the photo goes to OpenAI.

**Tests:** shortlist scoring on fixtures; endpoint tests with the AI mocked; vitest for the confirm screen. Then 10 real photos: keep the feature only if at least about 7 in 10 garments are matched correctly.

**Risks:** two vision calls per photo (a few pence); hidden layers; plain basics (several white tees) are hard to tell apart, so the confirm screen matters.

---

## 11. Step 8: E, flat-lay outfit image

**Goal:** each suggestion shows as one picture with the garments laid out together, like the outfit posts you see online.

**What the code does today:** background removal flattens the garment onto a **solid colour** (white by default), so no transparent cut-out is kept. Items already have an outfit role (`ITEM_ROLE`), which gives the layout order.

**v1: screens only, no cut-outs needed**
1. New `components/outfits/flat-lay.tsx`: a canvas that places each item's medium image by role (outer layer and top high, bottoms below, shoes at the bottom, accessories to the side), drawn with `multiply` blending so the white backgrounds disappear.
2. Shown on each suggestion and in the outfit preview, with a Download button.
3. **Web Share won't work on Vault for now.** The browser only offers it on secure (`https`) pages and Vault is plain `http` on the LAN. v1 downloads a PNG. Tailscale HTTPS later switches sharing on.
4. Tests: the layout function (role → position) as a plain function; check three outfit sizes visually.

**v2 (later):** the image worker saves a transparent PNG cut-out next to each photo (found by file name, no migration), for clean layouts on any background and shadows. Wait to see what upstream #278 (better cut-outs, heavier model) changes first.

---

## 12. Upstream landscape

- **Open PRs that overlap our files:** #228 (size, store, care; 1 migration), #283 (several photos per item; 93 files, 2 migrations), #277 (background removal while uploading), #278 (better background removal, heavier default model). None has merged. Upstream `main` hasn't moved since our base (`d1bae17`), and 1.12.0 is waiting in the release PR.
- **When upstream moves:** fetch, rebase `plus` and the open feature branches, and re-run CI. Small branches that touch the crowded files lightly (rule in section 2) make this cheap.
- **Ready to send upstream now:** PR #2 (account language on new devices) and PR #3 (type-as-subtype fix). They're small bug fixes. en-GB should wait for a word on #269.

---

## 13. Decisions I need from you

1. **Splitting in bulk upload (phase 2):** opt-in checkbox, off by default (my recommendation), or on by default?
2. **After a split:** archive the original photo's item (my recommendation, reversible) or delete it?
3. **Send PRs #2 and #3 upstream now?**
4. **Post issue drafts 2, 3 and 4 now,** or when we reach each? I'd wait, to see how the maintainer reacts to the first three.
5. **Memory on Vault:** is a 2 GB limit on the image worker acceptable? Home Assistant needs headroom, and the RAM upgrade is still pending.

---

## 14. Not app features, but on the list

These are in the original install plan and aren't planned in detail here.
- **More RAM (16 GB).** Only about 2 GB is free with Home Assistant running.
- **Mirror the photo drive.** Photos live only on one hard drive, and so do the database backups.
- **Tailscale + HTTPS:** access away from home, the official iOS app, and Web Share.
- **PocketID login,** then turn off the passwordless dev login.
- **Move AI to Ajax** for local processing. It also removes the privacy question for G.

---

## Reference

### Fork and branch setup
- One branch per feature from `upstream/main`, named like `feat/split-photo`. `plus` = upstream `main` + merged features, and is what gets built and run.
- Local tools: Node 24 at `~/.local/node24/bin` (Homebrew's `node@24` is broken by a half-installed openssl). Backend tests need `PATH=backend/.venv/bin:$PATH` and Postgres and Redis on spare ports (your other project uses 3000, 3001 and 6379). Colima provides Docker locally.
- 4 backend tests fail on macOS only (timezone `utc`, batch progress), and also on untouched upstream. CI on Linux passes. `frontend/tests/upload-manager.test.ts` is flaky under full-suite load and passes on rerun.
- CI on `plus` is enabled by a one-line change in `.github/workflows/ci.yml` on that branch only.

### Vault deployment (`/volume2/docker/wardrowbe`)
- `.env`: `WARDROWBE_IMAGE=ghcr.io/mallard-marsh/wardrowbe`, `WARDROWBE_VERSION=1.11.0-plus.2`. The images are public, so Vault pulls without a login.
- **New release:** run Docker Publish on `plus` with the next `1.11.0-plus.N`, then follow the deploy routine in section 2.
- **Roll back to official:** set `WARDROWBE_IMAGE=ghcr.io/anyesh/wardrowbe` and `WARDROWBE_VERSION=1.11.0`, `chmod 600 .env`, `docker compose pull && docker compose up -d`. This is safe because `plus` has no extra migrations. Users set to en-GB fall back to English (US) on the official build.
- Backups (HDD, `Vault Archive/apps/wardrowbe/backups`): the `db-backup` container dumps nightly at 03:15 UK time and keeps 14 days. Kept by hand: `pre-plus-2026-10-18-1707.sql.gz` and `pre-plus2-2026-10-18-1843.sql.gz`. In the stack folder: `docker-compose.yml.pre-plus` and `.env.pre-plus`.
- Saving `.env` makes UGOS re-apply the share's open permissions, so run `chmod 600 .env` after every edit. `scp` can't see `/volume2`; pipe files in with `ssh ... 'cat > file' < file`.

### Done: A. English (UK) locale
`messages/en-GB/` is generated from `en` by `frontend/scripts/gen-en-gb.mjs` (spelling rules plus whole-string overrides in `frontend/i18n/en-GB-overrides.json`). `i18n:check` fails if it's stale, and CONTRIBUTING.md in the fork documents it. Locale handling: `backend/app/data/locales.json` is the source and `npm run vocab:gen` writes the frontend copy.
