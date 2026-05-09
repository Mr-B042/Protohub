function randomFourDigits() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint16Array(1);
    crypto.getRandomValues(values);
    return values[0] % 10000;
  }

  return Math.floor(Math.random() * 10000);
}

export function makeOrderId() {
  return `${Date.now()}${String(randomFourDigits()).padStart(4, "0")}`;
}
