import assert from "node:assert/strict";
import test from "node:test";
import { requestItemMatchScore } from "../request-matching.js";

const items = [
  { id: "microsoft-data", name: "Microsoft", username: "data@fernclinic.com", owner: "Data", purpose: "รายงาน" },
  { id: "microsoft-manager", name: "Microsoft", username: "manager@fernclinic.com", owner: "Manager", purpose: "บริหาร" },
  { id: "google-marketing", name: "Google Workspace", username: "marketing@fernclinic.com", owner: "Marketing", purpose: "โฆษณา" },
];

test("structured LINE selection always chooses the exact Vault item", () => {
  const request = {
    requestVaultItemId: "microsoft-manager",
    system: "Microsoft",
    requestAccount: "manager@fernclinic.com",
    reason: "ขอ Password",
  };
  const ranked = [...items].sort((a, b) => requestItemMatchScore(request, b) - requestItemMatchScore(request, a));
  assert.equal(ranked[0].id, "microsoft-manager");
});

test("typed account name and email rank the matching login first", () => {
  const request = {
    system: "Microsoft manager@fernclinic.com",
    requestAccount: "",
    reason: "ต้องการใช้เมล manager@fernclinic.com",
  };
  const ranked = [...items].sort((a, b) => requestItemMatchScore(request, b) - requestItemMatchScore(request, a));
  assert.equal(ranked[0].id, "microsoft-manager");
  assert.ok(requestItemMatchScore(request, ranked[0]) > requestItemMatchScore(request, ranked[1]));
});

test("matching never reads or compares stored passwords", () => {
  const request = { system: "Google Workspace", requestAccount: "marketing@fernclinic.com", reason: "ขอใช้งาน" };
  const withPassword = { ...items[2], password: "secret-value" };
  const withoutPassword = { ...items[2] };
  assert.equal(requestItemMatchScore(request, withPassword), requestItemMatchScore(request, withoutPassword));
});
