import { base64UrlToBytes, openSharePayload } from "./vault-crypto.js";
import { readSharePayload, removeSharePayloadFromAddressBar } from "./share-link.js";

const $ = (selector) => document.querySelector(selector);
let credential = null;
let showingPassword = false;
const encryptedPayload = readSharePayload(location.href);
removeSharePayloadFromAddressBar(encryptedPayload);

function formatExpiry(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function showError(message) {
  $("#shareError").textContent = message;
  $("#shareError").hidden = false;
}

function inspectExpiry() {
  if (!encryptedPayload) {
    $("#shareUnlock").hidden = true;
    return showError("ลิงก์นี้ไม่มีข้อมูล หรือถูกคัดลอกมาไม่ครบ");
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encryptedPayload)));
    if (new Date(payload.e) <= new Date()) {
      $("#shareUnlock").hidden = true;
      return showError("ลิงก์นี้หมดอายุแล้ว กรุณาขอข้อมูลใหม่จากผู้ดูแล");
    }
    $("#shareExpiry").textContent = `ลิงก์หมดอายุ ${formatExpiry(payload.e)}`;
  } catch {
    $("#shareUnlock").hidden = true;
    showError("รูปแบบลิงก์ไม่ถูกต้อง");
  }
}

$("#shareUnlockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "กำลังถอดรหัส…";
  $("#shareError").hidden = true;
  try {
    credential = await openSharePayload(encryptedPayload, form.elements.pin.value);
    $("#shareTitle").textContent = credential.title || "ข้อมูลเข้าใช้งาน";
    $("#shareRecipient").textContent = `สำหรับ ${credential.recipient || "ผู้รับที่ได้รับอนุญาต"} · หมดอายุ ${formatExpiry(credential.expiresAt)}`;
    $("#shareUsername").textContent = credential.username || "—";
    $("#shareNote").textContent = credential.note || "";
    $("#shareNote").hidden = !credential.note;
    $("#shareUnlock").hidden = true;
    $("#shareContent").hidden = false;
    form.reset();
  } catch {
    showError("PIN ไม่ถูกต้อง ลิงก์เสียหาย หรือข้อมูลหมดอายุแล้ว");
  } finally {
    button.disabled = false;
    button.textContent = "เปิดข้อมูลอย่างปลอดภัย";
  }
});

$("#toggleSharePassword").addEventListener("click", () => {
  if (!credential) return;
  showingPassword = !showingPassword;
  $("#sharePassword").textContent = showingPassword ? credential.password : "••••••••••••";
  $("#toggleSharePassword").textContent = showingPassword ? "ซ่อน" : "แสดง";
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-share]");
  if (!button || !credential) return;
  const value = credential[button.dataset.copyShare];
  if (!value) return;
  await navigator.clipboard.writeText(value);
  const previous = button.textContent;
  button.textContent = "คัดลอกแล้ว";
  setTimeout(() => { button.textContent = previous; }, 1200);
});

$("#closeShare").addEventListener("click", () => {
  credential = null;
  showingPassword = false;
  history.replaceState(null, "", location.pathname);
  $("#shareContent").hidden = true;
  showError("ข้อมูลถูกล้างจากหน้าจอนี้แล้ว");
});

inspectExpiry();
