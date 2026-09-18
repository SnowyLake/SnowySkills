import fs from "node:fs/promises";
import path from "node:path";
import { comparisonKey, comparisonName, selectComparisonCandidates } from "./comparison-ranking.mjs";

const stageSpecs = [
  { stage: "Vertex", maliVariant: "Position", label: "VS Position" },
  { stage: "Vertex", maliVariant: "Varying", label: "VS Varying" },
  { stage: "Fragment", maliVariant: "Main", label: "PS Main" },
];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isUnityProject(directory) {
  return await exists(path.join(directory, "Assets")) && await exists(path.join(directory, "Packages"));
}

function ancestors(start) {
  const values = [];
  let current = path.resolve(start);
  while (true) {
    values.push(current);
    const parent = path.dirname(current);
    if (parent === current) return values;
    current = parent;
  }
}

async function findUnityProjectRoot(explicitRoot, inputPath) {
  const seeds = [explicitRoot, process.cwd(), path.dirname(path.resolve(inputPath))].filter(Boolean);
  for (const seed of seeds) {
    for (const candidate of ancestors(seed)) {
      if (await isUnityProject(candidate)) return candidate;
      const nested = path.join(candidate, "UnityProj");
      if (await isUnityProject(nested)) return nested;
    }
  }
  throw new Error("Unable to locate a Unity project root containing Assets and Packages.");
}

async function buildPackageMap(unityRoot) {
  const result = new Map();
  const packageRoot = path.join(unityRoot, "Packages");
  for (const entry of await fs.readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(packageRoot, entry.name);
    result.set(entry.name, directory);
    const manifestPath = path.join(directory, "package.json");
    if (!await exists(manifestPath)) continue;
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      if (manifest.name) result.set(manifest.name, directory);
    } catch {
      // Ignore malformed package metadata and retain the directory-name mapping.
    }
  }

  const packageCache = path.join(unityRoot, "Library", "PackageCache");
  if (await exists(packageCache)) {
    for (const entry of await fs.readdir(packageCache, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageName = entry.name.split("@")[0];
      if (!result.has(packageName)) result.set(packageName, path.join(packageCache, entry.name));
    }
  }
  return result;
}

async function resolveLogicalPath(logicalPath, unityRoot, packageMap) {
  const normalized = String(logicalPath).replaceAll("\\", "/");
  if (path.isAbsolute(normalized) && await exists(normalized)) return path.resolve(normalized);
  if (normalized.startsWith("Assets/")) {
    const candidate = path.join(unityRoot, ...normalized.split("/"));
    return await exists(candidate) ? path.resolve(candidate) : null;
  }
  if (normalized.startsWith("Packages/")) {
    const [, packageName, ...rest] = normalized.split("/");
    const packageRoot = packageMap.get(packageName);
    if (packageRoot) {
      const candidate = path.join(packageRoot, ...rest);
      if (await exists(candidate)) return path.resolve(candidate);
    }
    const direct = path.join(unityRoot, ...normalized.split("/"));
    return await exists(direct) ? path.resolve(direct) : null;
  }
  return null;
}

async function resolveInclude(includePath, sourcePath, unityRoot, packageMap) {
  const logical = await resolveLogicalPath(includePath, unityRoot, packageMap);
  if (logical) return logical;
  const candidate = path.resolve(path.dirname(sourcePath), includePath.replaceAll("/", path.sep));
  return await exists(candidate) ? candidate : null;
}

async function collectSourceGraph(shaderPath, unityRoot, packageMap) {
  const queue = [shaderPath];
  const visited = new Set();
  const files = [];
  const unresolvedIncludes = [];
  const includePattern = /^\s*#\s*include(?:_with_pragmas)?\s*[<"]([^>"]+)[>"]/;

  while (queue.length > 0) {
    const sourcePath = queue.shift();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const source = await fs.readFile(sourcePath, "utf8");
    const lines = source.replaceAll("\r\n", "\n").split("\n");
    files.push({ sourcePath, lines });
    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(includePattern);
      if (!match) continue;
      const resolved = await resolveInclude(match[1], sourcePath, unityRoot, packageMap);
      if (resolved) queue.push(resolved);
      else unresolvedIncludes.push({ sourcePath, line: index + 1, includePath: match[1] });
    }
  }
  return { files, unresolvedIncludes };
}

function keywordPattern(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`);
}

function findConditionalHits(lines, keyword) {
  const pattern = keywordPattern(keyword);
  const directivePattern = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)$/;
  const stack = [];
  const hits = [];

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(directivePattern);
    if (!match) continue;
    const directive = match[1];
    if (["if", "ifdef", "ifndef"].includes(directive)) {
      stack.push({ startIndex: index, directiveIndexes: pattern.test(lines[index]) ? [index] : [] });
      continue;
    }
    if (directive === "elif") {
      const current = stack.at(-1);
      if (current && pattern.test(lines[index])) current.directiveIndexes.push(index);
      continue;
    }
    if (directive !== "endif") continue;
    const current = stack.pop();
    if (!current || current.directiveIndexes.length === 0) continue;
    const firstDirective = current.directiveIndexes[0];
    const contextStart = Math.max(current.startIndex, firstDirective - 3);
    const contextEnd = Math.min(index, firstDirective + 15);
    hits.push({
      keyword,
      blockStartLine: current.startIndex + 1,
      blockEndLine: index + 1,
      directiveLines: current.directiveIndexes.map((value) => value + 1),
      excerptStartLine: contextStart + 1,
      excerptEndLine: contextEnd + 1,
      excerpt: lines.slice(contextStart, contextEnd + 1).map((line, offset) => `${contextStart + offset + 1}: ${line}`).join("\n"),
    });
  }
  return hits;
}

function propertyValue(row, name) {
  return row?.malioc?.variant?.properties?.find((item) => item.name === name)?.value;
}

function bottleneckCycles(row) {
  const cycles = (row?.malioc?.variant?.performance?.total_cycles?.cycle_count ?? []).filter(Number.isFinite);
  return cycles.length > 0 ? Math.max(...cycles) : null;
}

function rankComparisons(analysis) {
  const records = new Map();
  for (const row of analysis.variants ?? []) records.set(`${row.stage}|${row.maliVariant}|${row.variantId}`, row);
  const groups = new Map();

  for (const comparison of analysis.comparisons ?? []) {
    const deltas = [];
    for (const stage of stageSpecs) {
      const baseline = records.get(`${stage.stage}|${stage.maliVariant}|${comparison.baselineVariantId}`);
      const candidate = records.get(`${stage.stage}|${stage.maliVariant}|${comparison.candidateVariantId}`);
      if (!baseline || !candidate) continue;
      const baselineTotalCycles = bottleneckCycles(baseline);
      const candidateTotalCycles = bottleneckCycles(candidate);
      deltas.push({
        stage: stage.label,
        baselineTotalCycles,
        candidateTotalCycles,
        totalDeltaCycles: baselineTotalCycles == null || candidateTotalCycles == null ? null : candidateTotalCycles - baselineTotalCycles,
        baselineBoundPipelines: baseline.malioc?.variant?.performance?.total_cycles?.bound_pipelines ?? [],
        candidateBoundPipelines: candidate.malioc?.variant?.performance?.total_cycles?.bound_pipelines ?? [],
        spillRegression: propertyValue(baseline, "has_stack_spilling") === false && propertyValue(candidate, "has_stack_spilling") === true,
      });
    }
    const key = comparisonKey(comparison);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ comparison, deltas });
  }

  const candidates = [...groups.entries()].map(([key, pairs]) => {
    const candidates = pairs.flatMap((pair) => pair.deltas.map((delta) => ({ pair, delta }))).filter((item) => Number.isFinite(item.delta.totalDeltaCycles));
    const worst = candidates.sort((left, right) => right.delta.totalDeltaCycles - left.delta.totalDeltaCycles)[0];
    if (!worst) return null;
    const comparison = worst.pair.comparison;
    return {
      key,
      displayName: comparisonName(comparison),
      comparisonType: comparison.comparisonType,
      baselineVariantId: comparison.baselineVariantId,
      candidateVariantId: comparison.candidateVariantId,
      dependencyChain: comparison.dependencyChain ?? [],
      baselineKeywords: comparison.baselineKeywords,
      candidateKeywords: comparison.candidateKeywords,
      addedKeywords: comparison.addedKeywords,
      removedKeywords: comparison.removedKeywords,
      multiCompileContext: comparison.multiCompileContext ?? [],
      worstStage: worst.delta.stage,
      baselineTotalCycles: worst.delta.baselineTotalCycles,
      candidateTotalCycles: worst.delta.candidateTotalCycles,
      totalDeltaCycles: worst.delta.totalDeltaCycles,
      spillRegression: pairs.some((pair) => pair.deltas.some((delta) => delta.spillRegression)),
      stageDeltas: worst.pair.deltas,
    };
  }).filter(Boolean);
  return selectComparisonCandidates(candidates);
}

function repositoryPath(filePath, unityRoot) {
  return path.relative(path.dirname(unityRoot), filePath).replaceAll("\\", "/");
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  const lines = [
    "#if defined(_ROOT)",
    "float rootValue = 1;",
    "#if defined(_TARGET)",
    "float targetValue = 2;",
    "#endif",
    "#elif defined(_TARGET)",
    "float alternateValue = 3;",
    "#endif",
  ];
  const hits = findConditionalHits(lines, "_TARGET");
  assertSelfTest(hits.length === 2, "Expected nested and elif hits.");
  assertSelfTest(hits[0].blockStartLine === 3 && hits[0].blockEndLine === 5, "Nested block range is incorrect.");
  assertSelfTest(hits[1].blockStartLine === 1 && hits[1].blockEndLine === 8, "Elif block range is incorrect.");
  const selected = selectComparisonCandidates([
    ...Array.from({ length: 5 }, (_, index) => ({ key: `SPILL_${index}`, displayName: `SPILL_${index}`, totalDeltaCycles: 5 - index, spillRegression: true })),
    { key: "HIGH_DELTA", displayName: "HIGH_DELTA", totalDeltaCycles: 10, spillRegression: false },
    { key: "SECOND_DELTA", displayName: "SECOND_DELTA", totalDeltaCycles: 9, spillRegression: false },
  ]);
  assertSelfTest(selected.some((item) => item.key === "HIGH_DELTA"), "High-delta non-spill comparison was dropped.");
  assertSelfTest(selected[0]?.key === "HIGH_DELTA", "Selected comparisons were not sorted by descending Total cycle delta.");
  assertSelfTest(selected.length <= 10, "Comparison selection exceeded ten items.");
  const combination = {
    comparisonType: "SyntheticKeywordCombination",
    baselineKeywords: ["A"],
    candidateKeywords: ["A", "B", "C"],
    addedKeywords: ["B", "C"],
  };
  assertSelfTest(comparisonName(combination) === "B | C", "Synthetic combinations must use actual added keywords as their display name.");
  assertSelfTest(!comparisonName(combination).includes("ALL"), "Synthetic combination display names must not use artificial labels.");
  console.log("collect-code-evidence self-test passed");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const [inputPath, outputPath, explicitUnityRoot] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error("Usage: node collect-code-evidence.mjs <analysis.json> <output.json> [unity-project-root]");
  }
  const analysis = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (analysis.schemaVersion !== 4) throw new Error(`Unsupported analysis schema: ${analysis.schemaVersion}`);
  const unityRoot = await findUnityProjectRoot(explicitUnityRoot, inputPath);
  const packageMap = await buildPackageMap(unityRoot);
  const shaderPath = await resolveLogicalPath(analysis.run?.shaderPath, unityRoot, packageMap);
  if (!shaderPath) throw new Error(`Unable to resolve Shader path: ${analysis.run?.shaderPath}`);
  const sourceGraph = await collectSourceGraph(shaderPath, unityRoot, packageMap);
  const ranked = rankComparisons(analysis);
  const recommendations = ranked.map((item) => {
    const sourceHits = [];
    for (const file of sourceGraph.files) {
      for (const keyword of item.addedKeywords) {
        for (const hit of findConditionalHits(file.lines, keyword)) {
          sourceHits.push({ ...hit, sourcePath: repositoryPath(file.sourcePath, unityRoot) });
        }
      }
    }
    sourceHits.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath) || left.blockStartLine - right.blockStartLine);
    const { key, ...evidence } = item;
    return { ...evidence, sourceHits: sourceHits.slice(0, 20) };
  });
  const result = {
    schemaVersion: 2,
    shader: analysis.run?.shader,
    shaderPath: repositoryPath(shaderPath, unityRoot),
    generatedFrom: path.resolve(inputPath),
    selectionRule: "Union of the top five positive Total cycle deltas and top five Stack Spill regressions, deduplicated, maximum ten, sorted by descending maximum Total cycle delta.",
    sourceFilesScanned: sourceGraph.files.map((file) => repositoryPath(file.sourcePath, unityRoot)).sort(),
    unresolvedIncludes: sourceGraph.unresolvedIncludes.slice(0, 50).map((item) => ({
      sourcePath: repositoryPath(item.sourcePath, unityRoot),
      line: item.line,
      includePath: item.includePath,
    })),
    evidence: recommendations,
  };
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath: path.resolve(outputPath), shader: result.shader, evidenceCount: recommendations.length, sourceFilesScanned: result.sourceFilesScanned.length }, null, 2));
}

await main();
