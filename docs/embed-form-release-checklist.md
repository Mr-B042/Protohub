# Embed Form Release Checklist

Use this before pushing the new `Embed Form`, `Extra Offers`, `Combo Library`, and combo inventory flow to production.

## 1. Database

- Apply migration `046_package_components_and_order_snapshots.sql`
- Apply migration `047_add_catalog_type_to_products.sql`

Expected result:
- products can have `catalog_type`
- package component breakdowns are stored
- orders can store package component snapshots

## 2. Global Embed Settings

Go to:
- `Embed Form -> Create Order Form`

Confirm:
- `Your State` uses dropdown mode, not free text
- required fields match your live sales process
- delivery question settings are correct
- assignment mode is correct:
  - `Auto-assign to Sales Rep`
  - or `Owner/Admin review first`

Expected result:
- customers choose from the state dropdown
- state-based offers can match correctly

## 3. Combo Library Setup

Go to:
- `Inventory -> Combo Library`

For each combo you want to sell:
1. Create the combo wrapper
2. Create bundle packages like:
   - `1 Set`
   - `3 Sets`
   - `6 Sets`
3. Add package components:
   - real stock items only
   - set the correct qty
4. Mark free gifts as free gifts
5. Save

Expected result:
- each combo package has a real stock breakdown
- free gifts are part of stock truth

## 4. Offer Placement Setup

Go to:
- `Inventory -> [Main Product] -> Manage Packages -> Edit Package`

Inside:
- `Promote This Package`

For each extra offer:
1. Click `+ Add extra offer`
2. Choose `Product`
3. Choose `Bundle target` if it should sell a combo package
4. Choose `Show in`
   - `Inside order form` for bump/add-on
   - `After submit page` for follow-up offer
5. Choose `Show everywhere`, `Show only in selected states`, or `Hide in selected states`
6. Add media:
   - desktop image upload
   - image URL
   - video URL
   - embed HTML
7. Save the package

Expected result:
- the main package owns the offer
- the offer targets either a plain item or a combo package

## 5. Media Rules

Confirm the offer behaves correctly with:
- image upload only
- image URL only
- video URL only
- embed HTML

Media priority should be:
1. `Embed HTML`
2. `Video URL`
3. `Image`

Expected result:
- no broken box
- no reload loop
- mobile view is still usable

## 6. State Rule QA

Test at least 3 cases:

1. Allowed state
- example: `Lagos`
- offer should appear

2. Blocked state
- example: `Bauchi`
- offer should not appear at all

3. Alternate allowed state
- example: `FCT Abuja`
- offer should appear

Expected result:
- offer stays hidden until state is chosen
- disallowed states do not expose the offer section

## 7. Order Form QA

Use the generated order link and test:

1. Main package only
- no extra offer chosen

2. Main package + inline add-on
- choose one offer

3. Main package + combo add-on package
- choose bundle like `1 Set` or `3 Sets`

4. Main package + after-submit offer
- submit order
- accept the upsell

5. Main package + after-submit offer
- submit order
- skip the upsell

Expected result:
- total amount is correct
- selected offer saves correctly
- redirect still works

## 8. Inventory Truth QA

Create one real proof order with:
- a combo main package
or
- a combo add-on package

Then mark it `Delivered`.

Confirm:
- all real component items deduct from stock
- free gifts deduct too
- stock movements show every component line

Expected result:
- no fake combo-only stock deduction
- inventory follows the real stock items underneath

## 9. Admin UX QA

Go to:
- `Embed Form -> Extra Offers`

Confirm:
- it is clearly overview-only
- `Edit this offer ->` opens the correct package editor
- `Open this product's packages` opens the correct Inventory package list
- path text is visible:
  - `Inventory > Product > Manage Packages > Package`

Expected result:
- no one confuses this page for the real picker/editor

## 10. Production Data Prep

Before launch, make sure production has:
- the combo wrappers you actually want to sell
- the package bundles
- the component breakdowns
- the real media links
- the state restrictions you want

Important:
- local preview data does not automatically exist in production

## 11. Final Go/No-Go

Go live only if all are true:
- migrations applied
- state dropdown active
- at least one add-on tested live end-to-end
- at least one combo package tested live end-to-end
- one delivered proof order confirms stock deductions
- redirect flow still works
- mobile form still looks correct

## 12. First Live Watch

After release, watch the first few live orders for:
- missing add-on rows
- wrong totals
- broken media embeds
- blocked save on order submit
- stock mismatch after delivery

If anything fails:
- disable the affected extra offer on the package
- keep the main form live
- fix the offer and re-enable it
