# Public Form Release Gate

Use this before shipping any public embed / landing-page order form changes.

## What it protects

This smoke test is designed to catch the exact failures that hurt sales:
- React crash / error boundary
- `Order form unavailable`
- missing main CTA
- broken required-field validation

It is intentionally **non-destructive**:
- it does **not** create a real order
- it clicks `Order Now` with missing fields and verifies the form blocks inline

## One-time setup

Install dependencies:

```bash
npm install
```

## Local smoke test

Default local URL:

```text
http://127.0.0.1:5174/#/order-form/embed?product=d7f0b40f-38cc-49a8-94a2-bba3d1347921&currency=NGN&preview=1
```

Run:

```bash
npm run test:public-form:smoke
```

## Production smoke test

Point the smoke test at a real live embed URL:

```bash
PUBLIC_FORM_SMOKE_URL="https://protohub-zeta.vercel.app/#/order-form/embed?product=YOUR_PRODUCT_ID&currency=NGN" npm run test:public-form:smoke
```

If that form should include additional items, require that too:

```bash
PUBLIC_FORM_SMOKE_URL="https://protohub-zeta.vercel.app/#/order-form/embed?product=YOUR_PRODUCT_ID&currency=NGN" \
PUBLIC_FORM_SMOKE_EXPECT_ADDITIONAL_ITEMS=1 \
npm run test:public-form:smoke
```

## Full release gate

Run the exact release gate:

```bash
PUBLIC_FORM_SMOKE_URL="https://protohub-zeta.vercel.app/#/order-form/embed?product=YOUR_PRODUCT_ID&currency=NGN" npm run release:public-form
```

This runs:
- frontend build
- backend build
- browser smoke test

## Minimum rule

Do **not** push public-form changes live unless `npm run release:public-form` passes.
