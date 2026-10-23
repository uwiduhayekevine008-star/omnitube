import test from "node:test";
import assert from "node:assert/strict";
import { buildMasterPlaylist, contentTypeFor, scaleWithinBounds } from "./worker.mjs";

test("landscape renditions preserve aspect ratio and never upscale", () => {
  assert.deepEqual(scaleWithinBounds(1920, 1080, 360), { width: 640, height: 360 });
  assert.deepEqual(scaleWithinBounds(1280, 720, 720), { width: 1280, height: 720 });
  assert.deepEqual(scaleWithinBounds(320, 240, 360), { width: 320, height: 240 });
});

test("portrait renditions fit the vertical profile", () => {
  assert.deepEqual(scaleWithinBounds(720, 1280, 360), { width: 360, height: 640 });
  assert.deepEqual(scaleWithinBounds(1080, 1920, 720), { width: 720, height: 1280 });
});

test("master playlist contains only the supplied real variants", () => {
  const manifest = buildMasterPlaylist([
    { name: "360p", width: 640, height: 360, bandwidth: 650000 },
    { name: "720p", width: 1280, height: 720, bandwidth: 1600000 },
  ]);
  assert.match(manifest, /#EXT-X-STREAM-INF:BANDWIDTH=650000,AVERAGE-BANDWIDTH=533000,RESOLUTION=640x360\n360p\/index\.m3u8/);
  assert.match(manifest, /#EXT-X-STREAM-INF:BANDWIDTH=1600000,AVERAGE-BANDWIDTH=1312000,RESOLUTION=1280x720\n720p\/index\.m3u8/);
  assert.doesNotMatch(manifest, /1080p/);
});

test("storage response content types are explicit", () => {
  assert.equal(contentTypeFor("master.m3u8"), "application/vnd.apple.mpegurl");
  assert.equal(contentTypeFor("segment_00001.ts"), "video/mp2t");
  assert.equal(contentTypeFor("unknown.bin"), "application/octet-stream");
});

test("invalid source dimensions fail before FFmpeg is invoked", () => {
  assert.throws(() => scaleWithinBounds(0, 1080, 360), /Invalid source/);
});
