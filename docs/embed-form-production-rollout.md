# Embed Form Production Rollout

Use this when you are ready to release the new embed form work:
- Extra offers
- Combo Library
- package component inventory
- state-based offer targeting
- media support for add-ons / after-submit offers

This is the safest rollout order.

## Release Order

### 1. Freeze changes

Before touching production:
- stop changing combo setup locally
- decide the exact first live products/offers to enable
- keep the first rollout small

Recommended first live rollout:
- 1 main product
- 1 inline add-on
- 1 combo add-on
- 1 after-submit offer

Do not launch every new combo at once on day one.

### 2. Take a production safety snapshot

Before migrations:
- export the production DB backup
- note current frontend and backend commit hashes
- note current live embed settings

Minimum safety notes to save:
- current live `Embed Form` settings
- current production product/package counts
- current stock totals for the items used in the first combo

### 3. Apply DB migrations first

Apply:
- `046_package_components_and_order_snapshots.sql`
- `047_add_catalog_type_to_products.sql`

Why this order matters:
- backend code expects these columns/tables to exist
- production order save and delivery stock logic depend on them

Do not deploy the new backend before these are applied.

### 4. Deploy backend second

Deploy the backend changes that include:
- `embed-settings`
- `products`
- `public-products`
- `public-orders`
- order inventory snapshot logic

Why backend second:
- public order submit
- upsell accept
- state filtering
- combo stock snapshots

all live there.

### 5. Smoke-test backend before frontend

Check:
- `/health`
- authenticated admin load still works
- existing normal order create still works

If possible, verify:
- product package save still works
- embed settings save works

Do this before pushing customers to the new frontend behavior.

### 6. Deploy frontend third

Deploy the frontend after backend is ready.

This release includes:
- `Extra Offers` overview changes
- `Combo Library`
- package editor `Promote This Package`
- public form offer rendering
- state dropdown behavior

### 7. Configure production data

Now create the real production setup:

#### A. Combo Library
- create combo wrappers
- create bundle packages
- add package components
- mark free gifts

#### B. Main product package
- open the main product
- `Manage Packages`
- `Edit Package`
- `Promote This Package`
- add the real offers

#### C. Media
- upload image or add image URL
- add video URL or embed HTML if needed
- confirm mobile behavior

#### D. State targeting
- choose:
  - `Show everywhere`
  - `Show only in selected states`
  - `Hide in selected states`

### 8. Set global embed settings

Go to:
- `Embed Form -> Create Order Form`

Confirm:
- `Your State` uses dropdown mode
- assignment mode is correct
- required fields are correct
- delivery settings are correct

Important:
- state-based offers are much safer with dropdown mode

### 9. Generate the real link

Go to:
- `Embed Form -> Generate`

Choose:
- the real base product
- redirect URL if needed
- currency

Then:
- generate the embed link
- copy the direct link or iframe code

### 10. Production smoke test

Run these in order.

#### Test 1. Main product only
- open the live form
- choose state
- choose package
- submit without any extra offer

Expected:
- order saves
- total is correct

#### Test 2. Inline add-on
- choose a state where the add-on should appear
- select the add-on
- submit

Expected:
- add-on line saved
- total increases correctly

#### Test 3. Blocked state
- choose a state where the add-on should not appear

Expected:
- offer does not show at all

#### Test 4. After-submit offer
- submit a base order
- accept the after-submit offer

Expected:
- amount updates
- extra line is added to the order

#### Test 5. Skip after-submit offer
- submit another base order
- skip the offer

Expected:
- thank-you redirect still works

### 11. Inventory proof test

Create one real proof order using:
- a combo main package
or
- a combo add-on package

Then mark it `Delivered`.

Confirm:
- each component item deducts from stock
- each free gift deducts too
- stock movement entries are recorded

This is the most important production proof.

### 12. Watch first live traffic

For the first few real orders, check:
- order total correctness
- add-on line correctness
- state-based visibility correctness
- media rendering
- delivery-side stock movement correctness

Watch especially for:
- offer appears in wrong state
- offer missing in allowed state
- broken embed media
- order save fails
- stock mismatch after delivery

## Rollback Plan

If something goes wrong:

### Fast rollback
- disable the affected extra offer from the package
- keep the main form live
- do not disable the whole product unless base ordering is broken

### Medium rollback
- revert frontend if rendering is broken
- keep backend if data structure is already live and healthy

### Full rollback
Only if there is a serious issue with order save or stock truth:
- stop traffic to the new embed form
- restore old deployment
- investigate production rows created during the failed window

## Best First Live Scope

Start with:
- 1 product
- 1 state-targeted inline add-on
- 1 combo package
- 1 after-submit offer

Then expand after the first delivered proof order succeeds.

## Sign-off

Do not call this release complete until all are true:
- migrations applied
- backend deployed
- frontend deployed
- combo setup created in production
- embed settings confirmed
- one live order saved successfully
- one live combo order saved successfully
- one delivered proof order deducted stock correctly
