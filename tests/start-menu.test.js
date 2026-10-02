import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("start screen offers Light and Heavy as radio cards before DRIVE", () => {
  const select = html.indexOf('id="vehicle-select"');
  const drive = html.indexOf('id="start"');
  const name = html.indexOf('id="player-name"');
  assert.ok(select > name && select < drive, "name -> vehicle -> drive order");
  assert.match(html, /<input type="radio" name="vehicle-class" value="light"/);
  assert.match(html, /<input type="radio" name="vehicle-class" value="heavy"/);
  assert.match(html, /<legend class="vehicle-select-title">Choose your vehicle<\/legend>/);
});

test("What's New leads with the Heavy Vehicle and explosion entries", () => {
  const list = html.slice(html.indexOf('class="intro-patch-list"'));
  const heavy = list.indexOf("Heavy Vehicle");
  const boom = list.indexOf("Bigger explosions");
  const battery = list.indexOf("Battery &amp; Charging System") >= 0
    ? list.indexOf("Battery &amp; Charging System")
    : list.indexOf("Battery & Charging System");
  assert.ok(heavy > 0 && heavy < boom && boom < battery);
  assert.match(html, /intro-patch-version">v0\.3</);
});
