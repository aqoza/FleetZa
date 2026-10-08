import { describe, expect, it } from "vitest";
import { backoffMinutes, isSafeWebhookUrl, isValidEventList, signatureHeader, verifySignature } from "./webhooks";

describe("isSafeWebhookUrl", () => {
  it("accepts public https endpoints", () => {
    expect(isSafeWebhookUrl("https://hooks.example.com/fleet?x=1")).toBe(true);
    expect(isSafeWebhookUrl("https://172.32.0.1/x")).toBe(true);
    expect(isSafeWebhookUrl("https://api.example.com:8443/in")).toBe(true);
  });
  it("refuses http, credentials, local and private hosts", () => {
    for (const url of [
      "http://hooks.example.com/x",
      "https://user:pw@hooks.example.com/x",
      "https://localhost/x",
      "https://LOCALHOST:8080/x",
      "https://printer.local/x",
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://192.168.0.10/x",
      "https://172.16.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x",
      "https://a.com?x=1",
    ]) {
      expect(isSafeWebhookUrl(url), url).toBe(false);
    }
  });
});

describe("events", () => {
  it("validates names", () => {
    expect(isValidEventList(["vehicle.created", "*"])).toBe(true);
    expect(isValidEventList([])).toBe(false);
    expect(isValidEventList(["Vehicle Created"])).toBe(false);
  });
});

describe("signatures", () => {
  const secret = "whsec_" + "ab".repeat(24);
  const body = JSON.stringify({ event: "vehicle.created", data: { name: "شاحنة 7" } });

  it("matches a plain HMAC-SHA256 of `${t}.${body}`", async () => {
    // node -e 'crypto.createHmac("sha256", secret).update(`1700000000.${body}`).digest("hex")'
    const expected = "8b441f86cc8f6096ab6d79474d6d38c5a04a74bb895b60fa8f10a180eb178a2e";
    expect(await signatureHeader(secret, 1700000000, body)).toBe(`t=1700000000,v1=${expected}`);
  });

  it("verifies within tolerance and rejects tampering or replay", async () => {
    const header = await signatureHeader(secret, 1700000000, body);
    expect(await verifySignature(secret, header, body, 1700000100)).toBe(true);
    expect(await verifySignature(secret, header, body + " ", 1700000100)).toBe(false);
    expect(await verifySignature("whsec_other", header, body, 1700000100)).toBe(false);
    expect(await verifySignature(secret, header, body, 1700001000)).toBe(false);
  });

  it("backs off 1, 4, 16, 64, 256 minutes", () => {
    expect([1, 2, 3, 4, 5].map(backoffMinutes)).toEqual([1, 4, 16, 64, 256]);
  });
});
