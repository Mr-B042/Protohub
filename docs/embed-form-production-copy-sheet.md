# Embed Form Production Copy Sheet

Use this while entering the first live setup in the admin UI.

This is the fastest safe first release:
- Main product: `Multiple Hanger`
- One combo add-on only:
  - `Smart Add-On Combo -> 1 Set`

Add the bigger bundles later after the first live proof order succeeds.

---

## 1. Combo Library

Go to:
- `Inventory -> Combo Library`

Create combo:
- `Smart Add-On Combo`

### Bundle 1

Bundle name:
- `1 Set`

Bundle description:
- `2pcs Window Groove Tool + 1pc Mini Mop + FREE Absorbent Towel`

Price:
- `18500`

Currency:
- `NGN`

Bundle quantity:
- `1`

### Components for 1 Set

1. `Window Groove Tool`
- Qty: `2`
- Free gift: `No`

2. `Mini Mop`
- Qty: `1`
- Free gift: `No`

3. `Absorbent Towel`
- Qty: `1`
- Free gift: `Yes`

---

## 2. Main Product

Go to:
- `Inventory -> Multiple Hanger -> Manage Packages`

First launch package to edit:
- `Starter Pack`

Later you can repeat for:
- `Home Pack`
- `Family Pack`
- `Royal Pack`

---

## 3. Add The Extra Offer

Inside `Starter Pack`:
- `Edit Package`
- scroll to `Promote This Package`
- click `+ Add extra offer`

### What customers can buy

Product:
- `Smart Add-On Combo`

Bundle target:
- `1 Set`

Bundle count:
- `1`

Pricing:
- `Use product price`

### Who should see it?

State mode:
- `Show only in selected states`

States:
- `Lagos`
- `FCT Abuja`

### How should it look?

Show in:
- `Inside order form`

Format:
- `Big card`

Priority:
- `40`

Badge text:
- `Quick add-on`

Benefit line:
- `Get a cleaning combo with 2pcs Window Groove Tool, 1pc Mini Mop, and a FREE Absorbent Towel.`

Recommended media for first live:
- image upload
or
- image URL

Do not start first live with custom embed HTML unless you already proved it on your live domain.

---

## 4. Global Embed Settings

Go to:
- `Embed Form -> Create Order Form`

Recommended first live values:

State field:
- `Dropdown`

Assignment mode:
- choose one:
  - `Auto-assign to Sales Rep`
  - or `Owner/Admin review first`

Keep the rest simple for first launch.

---

## 5. Generate The Link

Go to:
- `Embed Form -> Generate`

Select:
- Product: `Multiple Hanger`
- Currency: `NGN`
- Redirect URL: your real thank-you page

Then:
- generate the link
- test it before placing on live landing pages

---

## 6. First Live Test

### Test A

State:
- `Lagos`

Expected:
- `Smart Add-On Combo -> 1 Set` appears

### Test B

State:
- `FCT Abuja`

Expected:
- `Smart Add-On Combo -> 1 Set` appears

### Test C

State:
- `Bauchi`

Expected:
- no combo add-on appears

---

## 7. First Delivered Proof Order

After one live order succeeds:
1. deliver that order
2. check stock movements

Expected stock deduction for `1 Set`:
- `Window Groove Tool x2`
- `Mini Mop x1`
- `Absorbent Towel x1`

If that is correct, then you can safely expand to:
- `3 Sets`
- `6 Sets`
- and other extra offers

---

## 8. Phase 2 Expansion

Only after the first proof order is correct:

Add:
- `Smart Add-On Combo -> 3 Sets`
- `Smart Add-On Combo -> 6 Sets`

Optional second offer later:
- `Foldable Storage Box`

State mode:
- `Show only in selected states`

States:
- `Rivers`
- `Oyo`
