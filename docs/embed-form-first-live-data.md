# First Live Embed Product Data Plan

This is the exact first-live setup I recommend based on the local embed flow already working.

## Main product

Create or reuse:
- `Multiple Hanger`

Packages:
- `Starter Pack` — `3 pcs` — `₦18,500`
- `Home Pack` — `5 pcs` — `₦28,500`
- `Family Pack` — `10 pcs` — `₦79,500`
- `Royal Pack` — `15 pcs` — `₦149,500`

Available states:
- all 36 states + `FCT Abuja`

## Combo Library item

Create in:
- `Inventory -> Combo Library`

Combo name:
- `Smart Add-On Combo`

Bundle packages:

### 1 Set
- Price: `₦18,500`
- Bundle quantity label: `1`
- Components:
  - `Window Groove Tool x2`
  - `Mini Mop x1`
  - `Absorbent Towel x1`
- Mark:
  - `Absorbent Towel` as `Free gift`

### 3 Sets
- Price: `₦49,500`
- Bundle quantity label: `3`
- Components:
  - `Window Groove Tool x6`
  - `Mini Mop x3`
  - `Absorbent Towel x3`
- Mark:
  - `Absorbent Towel` as `Free gift`

### 6 Sets
- Price: `₦96,000`
- Bundle quantity label: `6`
- Components:
  - `Window Groove Tool x12`
  - `Mini Mop x6`
  - `Absorbent Towel x6`
- Mark:
  - `Absorbent Towel` as `Free gift`

## Secondary normal add-on

Create or reuse:
- `Foldable Storage Box`

Recommended package options:
- `Duo Pack` — `2 pcs` — `₦22,000`
- `Value Pack` — `4 pcs` — `₦39,500`
- `Family Pack` — `6 pcs` — `₦56,000`
- `Mega Pack` — `8 pcs` — `₦74,500`

## First live offer placement

Go to:
- `Inventory -> Multiple Hanger -> Manage Packages -> Edit Package`

Repeat this on:
- `Starter Pack`
- `Home Pack`
- `Family Pack`
- `Royal Pack`

### Offer A — combo add-on

Use:
- `+ Add extra offer`

Set:
- Product: `Smart Add-On Combo`
- Bundle target: `1 Set`
- Show in: `Inside order form`
- Format: `Big card`
- Pricing: `Use product price`
- Priority: `40`
- State mode: `Show only in selected states`
- States:
  - `Lagos`
  - `FCT Abuja`
- Badge text:
  - `Quick add-on`
- Benefit line:
  - `Get a cleaning combo with 2pcs Window Groove Tool, 1pc Mini Mop, and a FREE Absorbent Towel.`

Media:
- safest first live option:
  - image upload or image URL
- avoid custom embed HTML on day one unless already proven on your live domain

### Offer B — bigger combo add-on

Add second row:
- Product: `Smart Add-On Combo`
- Bundle target: `3 Sets`
- Show in: `Inside order form`
- Format: `Big card`
- Pricing: `Use product price`
- Priority: `41`
- State mode: `Show only in selected states`
- States:
  - `Lagos`
  - `FCT Abuja`
- Badge text:
  - `Quick add-on`
- Benefit line:
  - `Upgrade to 3 full sets with free delivery and 3 FREE towels included.`

### Offer C — biggest combo add-on

Add third row:
- Product: `Smart Add-On Combo`
- Bundle target: `6 Sets`
- Show in: `Inside order form`
- Format: `Big card`
- Pricing: `Use product price`
- Priority: `42`
- State mode: `Show only in selected states`
- States:
  - `Lagos`
  - `FCT Abuja`
- Badge text:
  - `Quick add-on`
- Benefit line:
  - `Go bigger with 6 combo sets for family or resale use.`

### Offer D — normal state-limited extra item

Add fourth row:
- Product: `Foldable Storage Box`
- Bundle target: `Use single item only`
- Quantity: `1`
- Show in: `Inside order form`
- Format: `Small row`
- Pricing: `Custom price`
- Custom price: `₦18,000`
- Priority: `20`
- State mode: `Show only in selected states`
- States:
  - `Rivers`
  - `Oyo`
- Benefit line:
  - `Add one foldable storage box to organize clothes, toys, or shoes faster.`

## Global embed settings for this launch

Go to:
- `Embed Form -> Create Order Form`

Set:
- `Your State` = dropdown
- assignment mode = whichever your team wants live
- keep the rest simple for first launch

## First live smoke test matrix

### Test 1
- State: `Lagos`
- Main product package: `Starter Pack`

Expected:
- combo add-ons appear
- storage box does not appear

### Test 2
- State: `FCT Abuja`
- Main product package: `Starter Pack`

Expected:
- combo add-ons appear
- storage box does not appear

### Test 3
- State: `Rivers`
- Main product package: `Starter Pack`

Expected:
- combo add-ons do not appear
- storage box appears

### Test 4
- State: `Bauchi`
- Main product package: `Starter Pack`

Expected:
- none of the state-limited offers appear

## Safer day-one rule

If you want the safest first live release:
- launch only `Offer A`
- keep `Offer B`, `Offer C`, and `Offer D` off until the first live orders succeed

That means day one would be:
- `Multiple Hanger`
- `Starter/Home/Family/Royal Pack`
- only one combo add-on:
  - `Smart Add-On Combo -> 1 Set`

Then expand after:
- one successful live order
- one delivered proof order
- one stock deduction proof
