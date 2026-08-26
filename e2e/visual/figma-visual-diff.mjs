import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { PNG } from "pngjs";

const [referencePath, actualPath, diffPath, metricsPath, maxMaeArg = "3.5", channelThresholdArg = "20"] = process.argv.slice(2);

if (!referencePath || !actualPath || !diffPath || !metricsPath) {
  throw new Error("Usage: node scripts/figma-visual-diff.mjs <reference> <actual> <diff> <metrics> [max-mae] [channel-threshold]");
}

const maxMae = Number(maxMaeArg);
const channelThreshold = Number(channelThresholdArg);
const [referenceBuffer, actualBuffer] = await Promise.all([readFile(referencePath), readFile(actualPath)]);
const reference = PNG.sync.read(referenceBuffer);
const actual = PNG.sync.read(actualBuffer);

const metrics = {
  reference: { width: reference.width, height: reference.height },
  actual: { width: actual.width, height: actual.height },
  mae: null,
  changedPixelPercentage: null,
  channelThreshold,
  maxMae,
};

if (reference.width !== actual.width || reference.height !== actual.height) {
  await mkdir(path.dirname(metricsPath), { recursive: true });
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  throw new Error(`Image dimensions differ: reference ${reference.width}x${reference.height}, actual ${actual.width}x${actual.height}`);
}

const diff = new PNG({ width: reference.width, height: reference.height });
let totalAbsoluteDifference = 0;
let changedPixels = 0;
const pixelCount = reference.width * reference.height;

for (let index = 0; index < reference.data.length; index += 4) {
  const redDifference = Math.abs(reference.data[index] - actual.data[index]);
  const greenDifference = Math.abs(reference.data[index + 1] - actual.data[index + 1]);
  const blueDifference = Math.abs(reference.data[index + 2] - actual.data[index + 2]);
  const maximumChannelDifference = Math.max(redDifference, greenDifference, blueDifference);

  totalAbsoluteDifference += redDifference + greenDifference + blueDifference;
  if (maximumChannelDifference > channelThreshold) changedPixels += 1;

  const intensity = Math.min(255, maximumChannelDifference * 4);
  diff.data[index] = intensity;
  diff.data[index + 1] = Math.round((redDifference + greenDifference + blueDifference) / 6);
  diff.data[index + 2] = 0;
  diff.data[index + 3] = 255;
}

metrics.mae = totalAbsoluteDifference / (pixelCount * 3);
metrics.changedPixelPercentage = (changedPixels / pixelCount) * 100;

await Promise.all([
  mkdir(path.dirname(diffPath), { recursive: true }),
  mkdir(path.dirname(metricsPath), { recursive: true }),
]);
await Promise.all([
  writeFile(diffPath, PNG.sync.write(diff)),
  writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`),
]);

process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);

if (metrics.mae > maxMae) {
  throw new Error(`MAE ${metrics.mae.toFixed(4)} exceeds the visual contract limit ${maxMae.toFixed(4)}`);
}
