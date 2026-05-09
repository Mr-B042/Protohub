import { randomInt } from "node:crypto";

export function makeOrderId() {
  return `${Date.now()}${String(randomInt(0, 10000)).padStart(4, "0")}`;
}
