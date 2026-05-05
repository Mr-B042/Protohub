# Ordello Embed Generator Audit

Live page reviewed: `https://ordellocrm.vercel.app/dashboard/admin/embed?tab=generate`

## Screenshot Set

Live reference screenshots:

- `audit-screenshots/ordello-live-embed-generate-visible.png` - initial visible page state.
- `audit-screenshots/ordello-live-embed-create-bottom.png` - lower Create Order Form settings.
- `audit-screenshots/ordello-live-embed-generate-tab-visible.png` - Generate tab header and first product card.
- `audit-screenshots/ordello-live-embed-generate-bottom-1.png` - product card with redirect URL, currency, and generate button.
- `audit-screenshots/ordello-live-embed-generate-bottom-2.png` - lower product card state.
- `audit-screenshots/ordello-live-embed-generated-url.png` - generated Direct Link state.
- `audit-screenshots/ordello-live-embed-generated-html-iframe.png` - generated HTML/Iframe state.
- `audit-screenshots/ordello-live-embed-generated-elementor.png` - generated Elementor code state.
- `audit-screenshots/ordello-live-embed-generated-elementor-lower.png` - Elementor instruction area.

Local recreation screenshots:

- `audit-screenshots/ordello-local-embed-create-settings-fixed.png` - recreated Create Order Form settings.
- `audit-screenshots/ordello-local-embed-generate-top.png` - recreated Generate tab entry state.
- `audit-screenshots/ordello-local-embed-generate-product-card.png` - recreated per-product generator card.
- `audit-screenshots/ordello-local-embed-generated-direct.png` - recreated Direct Link state.
- `audit-screenshots/ordello-local-embed-generated-html-iframe.png` - recreated HTML/Iframe state.
- `audit-screenshots/ordello-local-embed-generated-elementor.png` - recreated Elementor code state.
- `audit-screenshots/ordello-local-embed-generated-elementor-lower.png` - recreated Elementor instruction area.

## Live Behavior

- The live embed generator has two tabs: `Create Order Form` and `Generate`.
- `Create Order Form` is the global settings area, not a separate product form builder.
- The settings area includes State field, Show email field, Show WhatsApp field, WhatsApp Required, Show package name, delivery window question, confirmation checkbox, commitment fee notice, Save changes, and Preview form.
- The admin State field selector shows two mode options: `Free-text input` and `Dropdown (36 Nigerian states)`. The full state list is not shown inside this admin selector.
- When State field is set to `Dropdown (36 Nigerian states)` and the form currency is NGN, the customer-facing form renders the 36 Nigerian states instead of a free-text state input.
- `Generate` lists all products that have active packages. Each product has its own card.
- Each product card shows product name, description, package count, Manage Packages, Redirect URL, Select Currency, and Generate Embed URL.
- After generating a product URL, that product card changes into three output tabs: Direct Link, HTML/Iframe, and Elementor.
- Direct Link provides a read-only URL plus copy and open buttons.
- HTML/Iframe provides an iframe snippet.
- Elementor uses the same iframe snippet and adds integration steps.
- The iframe snippet forwards UTM params from the landing page into the iframe and listens for `ordo-resize` messages to auto-resize the embedded form.

## Local Changes Made

- Matched the live two-tab structure.
- Moved global form settings under `Create Order Form`.
- Replaced the single product dropdown generator with per-product generator cards.
- Added per-product Redirect URL and Select Currency controls.
- Added generated Direct Link, HTML/Iframe, and Elementor output states.
- Added copy/open controls for generated direct links.
- Added UTM forwarding and iframe auto-resize logic to generated HTML code.
- Added Elementor integration instructions.
- Restyled settings toggles to match the live switch behavior more closely.
- Added the 36-state Nigerian dropdown behavior for NGN preview/public order forms.
