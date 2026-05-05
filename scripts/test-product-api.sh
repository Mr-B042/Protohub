#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4010}"
HOST="${HOST:-127.0.0.1}"
BASE_URL="${BASE_URL:-http://${HOST}:${PORT}}"
SERVER_LOG="${SERVER_LOG:-/tmp/protohub-product-api.log}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID"
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

json_value() {
  local path="$1"

  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const path = process.argv[1].split(".");
      let value = JSON.parse(raw);
      for (const segment of path) {
        if (segment === "") continue;
        if (/^\d+$/.test(segment)) {
          value = value[Number(segment)];
        } else {
          value = value[segment];
        }
      }
      if (typeof value === "object") {
        console.log(JSON.stringify(value));
      } else {
        console.log(String(value));
      }
    });
  ' "$path"
}

assert_contains() {
  local body="$1"
  local needle="$2"
  local label="$3"

  if [[ "$body" != *"$needle"* ]]; then
    echo "Assertion failed: $label"
    echo "$body"
    exit 1
  fi

  echo "PASS: $label"
}

request() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  if [[ -n "$data" ]]; then
    curl -fsS -X "$method" "$BASE_URL$path" \
      -H "Content-Type: application/json" \
      --data "$data"
  else
    curl -fsS -X "$method" "$BASE_URL$path"
  fi
}

node "$ROOT_DIR/mock-api/products-server.mjs" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in {1..40}; do
  if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
  echo "Mock server failed to start. Log output:"
  cat "$SERVER_LOG"
  exit 1
fi

echo "Running full product curl flow against $BASE_URL"

reset_response="$(request POST /api/mock/reset)"
assert_contains "$reset_response" "Mock product dataset reset." "dataset reset works"

list_response="$(request GET '/api/products?q=demo')"
assert_contains "$list_response" "Demo Audit Blender" "seed product list is queryable"

create_response="$(request POST /api/products '{
  "name": "Curl Test Product",
  "description": "Created end-to-end from the curl smoke test.",
  "sku": "CURL-TEST-001",
  "active": true,
  "reorderPoint": 8,
  "openingStock": 25,
  "pricing": {
    "currency": "NGN",
    "sellingPrice": 14500,
    "unitCost": 5200
  },
  "packageDescription": "Bundles for curl test coverage.",
  "role": "Main",
  "availableStates": ["Lagos", "Ogun"],
  "formCustomText": "Launch offer from curl"
}')"
assert_contains "$create_response" "Curl Test Product" "product creation works"

created_product_id="$(printf '%s' "$create_response" | json_value 'product.id')"

fetch_response="$(request GET "/api/products/$created_product_id")"
assert_contains "$fetch_response" "Curl Test Product" "product fetch works"

update_response="$(request PATCH "/api/products/$created_product_id" '{
  "name": "Curl Test Product Deluxe",
  "description": "Updated by curl after creation.",
  "reorderPoint": 14,
  "packageDescription": "Updated package notes from curl.",
  "formCustomText": "Updated launch copy"
}')"
assert_contains "$update_response" "Curl Test Product Deluxe" "product edit works"

add_pricing_response="$(request POST "/api/products/$created_product_id/pricings" '{
  "currency": "USD",
  "sellingPrice": 19,
  "unitCost": 6
}')"
assert_contains "$add_pricing_response" "\"currency\": \"USD\"" "add pricing works"

edit_pricing_response="$(request PATCH "/api/products/$created_product_id/pricings/USD" '{
  "sellingPrice": 21,
  "unitCost": 7,
  "primary": true
}')"
assert_contains "$edit_pricing_response" "\"primary\": true" "update pricing and set primary works"

add_package_response="$(request POST "/api/products/$created_product_id/packages" '{
  "name": "Triple Launch Bundle",
  "description": "3 units in one bundle.",
  "quantity": 3,
  "price": 39000,
  "currency": "NGN",
  "displayOrder": 1
}')"
assert_contains "$add_package_response" "Triple Launch Bundle" "add package works"

created_package_id="$(printf '%s' "$add_package_response" | json_value 'product.packages.0.id')"

edit_package_response="$(request PATCH "/api/products/$created_product_id/packages/$created_package_id" '{
  "name": "Triple Launch Bundle Plus",
  "quantity": 4,
  "price": 50000,
  "displayOrder": 2
}')"
assert_contains "$edit_package_response" "Triple Launch Bundle Plus" "edit package works"

stock_response="$(request POST "/api/products/$created_product_id/stock-adjustments" '{
  "change": 12,
  "by": "Curl Smoke Test",
  "note": "Restock before launch"
}')"
assert_contains "$stock_response" "Warehouse stock updated to 37." "stock adjustment works"

states_response="$(request PUT "/api/products/$created_product_id/state-availability" '{
  "availableStates": ["Lagos", "Oyo", "Ogun"]
}')"
assert_contains "$states_response" "\"Oyo\"" "state availability update works"

bonus_response="$(request PUT "/api/products/$created_product_id/bonus-config" '{
  "crossSellPercent": 9,
  "crossSellFixed": 250,
  "freeGiftBonus": 600,
  "deliveryRateMinOrders": 20,
  "manualOrderBonuses": [
    { "quantity": 3, "amount": 900 },
    { "quantity": 5, "amount": 1400 }
  ]
}')"
assert_contains "$bonus_response" "\"crossSellPercent\": 9" "bonus config update works"

relations_response="$(request PUT "/api/products/$created_product_id/relations" '{
  "crossSellProductIds": ["prod-satin-bonnet"],
  "freeGiftProductIds": ["prod-sample-oil"],
  "crossSellPriceOverrides": {
    "prod-satin-bonnet": 4200
  },
  "crossSellStateRestrictions": {
    "prod-satin-bonnet": ["Lagos", "Ogun"]
  },
  "freeGiftStateRestrictions": {
    "prod-sample-oil": ["Lagos"]
  }
}')"
assert_contains "$relations_response" "prod-satin-bonnet" "cross-sell and free gift relations work"

clone_response="$(request POST "/api/products/$created_product_id/clone" '{
  "name": "Curl Test Product Clone"
}')"
assert_contains "$clone_response" "Curl Test Product Clone" "product clone works"

cloned_product_id="$(printf '%s' "$clone_response" | json_value 'product.id')"

toggle_response="$(request POST "/api/products/$cloned_product_id/toggle-active")"
assert_contains "$toggle_response" "inactive" "toggle active works"

delete_package_response="$(request DELETE "/api/products/$created_product_id/packages/$created_package_id")"
assert_contains "$delete_package_response" "deleted" "delete package works"

delete_old_pricing_response="$(request DELETE "/api/products/$created_product_id/pricings/NGN")"
assert_contains "$delete_old_pricing_response" "pricing removed" "delete non-primary pricing works"

delete_product_response="$(request DELETE "/api/products/$created_product_id")"
assert_contains "$delete_product_response" "deleted" "delete product works"

delete_clone_response="$(request DELETE "/api/products/$cloned_product_id")"
assert_contains "$delete_clone_response" "deleted" "delete cloned product works"

final_list_response="$(request GET '/api/products?active=true')"
assert_contains "$final_list_response" "Edge Brusher Max" "seed products remain after cleanup"

echo "All curl product checks passed."
