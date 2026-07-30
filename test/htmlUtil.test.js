import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formatTelegramHtml } from "../src/htmlUtil.js";

test("escapeHtml: escape karakter spesial HTML", () => {
  assert.equal(escapeHtml("RSI < 30 & harga > support"), "RSI &lt; 30 &amp; harga &gt; support");
});

test("formatTelegramHtml: **bold** jadi <b>bold</b>", () => {
  assert.equal(formatTelegramHtml("**Keputusan:** BUY"), "<b>Keputusan:</b> BUY");
});

test("formatTelegramHtml: __bold__ (underscore ganda) juga jadi <b>", () => {
  assert.equal(formatTelegramHtml("__Bias Bullish__"), "<b>Bias Bullish</b>");
});

test("formatTelegramHtml: *italic* (satu bintang) jadi <i>italic</i>", () => {
  assert.equal(formatTelegramHtml("harga *breakout* area ini"), "harga <i>breakout</i> area ini");
});

test("formatTelegramHtml: beberapa **bold** dalam 1 baris semua ikut dikonversi", () => {
  const input = "**Support:** 100, **Resistance:** 120";
  const output = formatTelegramHtml(input);
  assert.equal(output, "<b>Support:</b> 100, <b>Resistance:</b> 120");
});

test("formatTelegramHtml: karakter HTML tetap di-escape lebih dulu (tidak bisa di-inject lewat AI)", () => {
  const input = "RSI **kuat** dan < 30 & masih naik";
  const output = formatTelegramHtml(input);
  assert.equal(output, "RSI <b>kuat</b> dan &lt; 30 &amp; masih naik");
});

test("formatTelegramHtml: teks tanpa markdown tidak berubah (selain escape)", () => {
  const input = "Tidak ada entry yang direkomendasikan saat ini.";
  assert.equal(formatTelegramHtml(input), input);
});

test("formatTelegramHtml: contoh nyata output AI Penyimpul (multi-baris + emoji)", () => {
  const input = "🎯 **Keputusan:** WAIT\n📊 **Bias Arah:** Bearish\n📍 **Level Kunci:** Support 72.24";
  const output = formatTelegramHtml(input);
  assert.equal(
    output,
    "🎯 <b>Keputusan:</b> WAIT\n📊 <b>Bias Arah:</b> Bearish\n📍 <b>Level Kunci:</b> Support 72.24"
  );
});
