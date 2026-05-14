# Embed Form Sign-off Sheet

Use this as the final gate before pushing the new `Embed Form` work to production.

Status meanings:
- `Done locally` = already proven on localhost/dev
- `Pending production` = must still be done on live/staging
- `Blocked` = do not launch until fixed

---

## A. Code + Schema

| Check | Local status | Production status | Notes |
|---|---|---|---|
| Migration `046` exists | Done locally | Pending production | Package components + order snapshots |
| Migration `047` exists | Done locally | Pending production | `catalog_type` / Combo Library |
| Backend build passes | Done locally | Pending production | `cd backend && npm run build` |
| Frontend build passes | Done locally | Pending production | `npm run build` |
| Embed settings save path fixed | Done locally | Pending production | Handles blank optional text safely |

### Sign-off
- [ ] `046` applied in production
- [ ] `047` applied in production
- [ ] backend deployed after migrations
- [ ] frontend deployed after backend

---

## B. Admin Setup UX

| Check | Local status | Production status | Notes |
|---|---|---|---|
| `Extra Offers` page clearly marked overview-only | Done locally | Pending production | Not a real editor |
| `Edit this offer` opens correct package editor | Done locally | Pending production | Fixed stale selected-product bug |
| `Open this product's packages` row action exists | Done locally | Pending production | Clear handoff into Inventory |
| path text is shown per row | Done locally | Pending production | `Inventory > Product > Manage Packages > Package` |
| package editor has `Promote This Package` | Done locally | Pending production | Real place to add add-ons |
| `Product` dropdown includes current product and combo library items | Done locally | Pending production | Same-product add-on path fixed |
| `Bundle target` can point to combo package | Done locally | Pending production | Package-based add-on architecture |

### Sign-off
- [ ] admin can understand where to edit offers without help
- [ ] row actions open the correct product/package every time

---

## C. Global Embed Settings

| Check | Local status | Production status | Notes |
|---|---|---|---|
| `Your State` can use dropdown mode | Done locally | Pending production | Recommended for state-based offers |
| required field toggles save correctly | Done locally | Pending production | Address / city / delivery / confirmation |
| assignment mode saves correctly | Done locally | Pending production | Auto-assign vs manual review |

### Sign-off
- [ ] production embed settings reviewed
- [ ] state field mode set to dropdown if using state-based offers

---

## D. Offer Logic

| Check | Local status | Production status | Notes |
|---|---|---|---|
| inline add-on supports normal item | Done locally | Pending production | `Inside order form` |
| inline add-on supports combo package target | Done locally | Pending production | via `Bundle target` |
| after-submit offer supports accept/skip | Done locally | Pending production | public upsell route |
| state modes `all / allow / block` work | Done locally | Pending production | frontend + backend enforced |
| disallowed states hide offer completely | Done locally | Pending production | no leakage before/after state selection |
| `FCT Abuja` normalization works | Done locally | Pending production | matches `Abuja` / `FCT` |

### Sign-off
- [ ] one `Show everywhere` offer tested
- [ ] one `Show only in selected states` offer tested
- [ ] one `Hide in selected states` offer tested

---

## E. Combo Inventory Truth

| Check | Local status | Production status | Notes |
|---|---|---|---|
| Combo Library exists | Done locally | Pending production | combo-only wrappers hidden from normal sell catalog |
| package components can be added | Done locally | Pending production | stock items + qty + free gift |
| package summary is generated | Done locally | Pending production | helps admin setup |
| order stores `package_components_snapshot` | Done locally | Pending production | for main package and combo add-ons |
| delivered order deducts real stock components | Done locally | Pending production | not fake combo-only deduction |
| free gifts also deduct from stock | Done locally | Pending production | included in stock truth |

### Sign-off
- [ ] one live combo package created
- [ ] one live delivered proof order deducts all component items correctly

---

## F. Media

| Check | Local status | Production status | Notes |
|---|---|---|---|
| desktop image upload supported | Done locally | Pending production | admin offer setup |
| image URL supported | Done locally | Pending production | offer setup |
| video URL supported | Done locally | Pending production | offer setup |
| embed HTML supported | Done locally | Pending production | use carefully in iframe context |
| media priority is clear | Done locally | Pending production | `Embed HTML -> Video -> Image` |

### Sign-off
- [ ] one image-based offer tested on mobile
- [ ] one video/embed-based offer tested on mobile
- [ ] no broken box / reload loop / crop problem on chosen live media

---

## G. Customer Flow

| Check | Local status | Production status | Notes |
|---|---|---|---|
| main package only order works | Done locally | Pending production | no extra offer |
| inline add-on order works | Done locally | Pending production | amount updates correctly |
| combo add-on order works | Done locally | Pending production | package snapshot saved |
| after-submit accept works | Done locally | Pending production | amount updates |
| after-submit skip works | Done locally | Pending production | redirect still works |
| thank-you redirect still works | Done locally | Pending production | per embed link |

### Sign-off
- [ ] one live order without extra offer
- [ ] one live order with inline add-on
- [ ] one live order with combo add-on
- [ ] one live order with after-submit accept

---

## H. Production Data Prep

These are not automatic.

- [ ] create the real combo wrappers in production
- [ ] create the real bundle packages in production
- [ ] add package components in production
- [ ] add free gifts in production
- [ ] attach the real offers to the main product packages
- [ ] add live media links/uploads
- [ ] set the real state restrictions

Important:
- local preview data does **not** automatically exist on production

---

## I. Go / No-Go

### Go live only if all are true
- [ ] migrations applied
- [ ] backend deployed
- [ ] frontend deployed
- [ ] production data setup completed
- [ ] embed settings confirmed
- [ ] one live base order passes
- [ ] one live extra-offer order passes
- [ ] one live delivered combo order updates stock correctly

### No-Go if any are true
- [ ] state-based offers appear in wrong states
- [ ] add-on totals are wrong
- [ ] order save fails
- [ ] media breaks the form
- [ ] stock deductions do not match component breakdown

---

## J. First Live Watch

For the first few live orders, manually inspect:
- [ ] order totals
- [ ] add-on lines
- [ ] combo package snapshots
- [ ] stock movements
- [ ] delivery-side stock deductions
- [ ] after-submit offer behavior

If something fails:
- disable only the affected extra offer first
- keep the base form live if normal orders still work
