# Mock Product API

Run the local mock server:

```bash
npm run mock:products
```

Run the end-to-end curl test suite:

```bash
npm run test:products:curl
```

Default base URL:

```text
http://127.0.0.1:4010
```

Useful routes:

```text
GET    /health
POST   /api/mock/reset
GET    /api/products
GET    /api/products/:productId
POST   /api/products
PATCH  /api/products/:productId
DELETE /api/products/:productId
POST   /api/products/:productId/pricings
PATCH  /api/products/:productId/pricings/:currency
DELETE /api/products/:productId/pricings/:currency
POST   /api/products/:productId/packages
PATCH  /api/products/:productId/packages/:packageId
DELETE /api/products/:productId/packages/:packageId
POST   /api/products/:productId/stock-adjustments
POST   /api/products/:productId/clone
POST   /api/products/:productId/toggle-active
PUT    /api/products/:productId/state-availability
PUT    /api/products/:productId/bonus-config
PUT    /api/products/:productId/relations
```

Example manual curl call:

```bash
curl -s http://127.0.0.1:4010/api/products | head
```
