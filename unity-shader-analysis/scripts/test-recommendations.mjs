import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

// Exercise the builder's actual input validation without the rendering dependency.
const source = await fs.readFile(new URL("./build-workbook.mjs", import.meta.url), "utf8");
const validation = source.slice(source.indexOf("if (analysis.schemaVersion"), source.indexOf("const workbook = Workbook.create();"));
assert.ok(validation.length > 0);
const analysis = { schemaVersion: 4, run: { shader: "Example/Lit" }, comparisons: [] };
const recommendation = {
  priority: "P1", expectedBenefit: "High", title: "Reuse direction", comparison: "_DETAIL",
  performanceEvidence: "PS Main Total 2 -> 3 cycles", codeEvidence: "The direction is normalized twice.",
  proposedChange: "Reuse the caller's direction.", risk: "Preserve precision.", acceptance: "Repeat comparison and visual checks.",
  confidence: "High", sourceLocations: ["Assets/Example.hlsl:10"],
};
const validate = (recommendations, overrides = {}) => vm.runInNewContext(validation, {
  analysis,
  recommendationDocument: { schemaVersion: 1, shader: "Example/Lit", recommendations, ...overrides },
});
for (const count of [0, 1, 4, 5, 10]) assert.doesNotThrow(() => validate(Array.from({ length: count }, () => ({ ...recommendation }))));
assert.throws(() => validate(Array(11).fill(recommendation)), /zero to ten/);
assert.throws(() => validate(null), /array/);
assert.throws(() => validate([{ ...recommendation, sourceLocations: [] }]), /source location/);
assert.throws(() => validate([{ ...recommendation, acceptance: "" }]), /acceptance/);
assert.throws(() => validate([], { shader: "Other/Lit" }), /Shader mismatch/);
console.log("Recommendation validation tests passed");
