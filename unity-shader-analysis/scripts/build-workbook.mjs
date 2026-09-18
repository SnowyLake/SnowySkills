import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import JSZip from "jszip";
import { comparisonKey, comparisonName, selectComparisonCandidates } from "./comparison-ranking.mjs";

const [inputPath, outputPath, previewDir, recommendationsPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !previewDir || !recommendationsPath) {
  throw new Error("Usage: node build-workbook.mjs <analysis.json> <output.xlsx> <preview-directory> <recommendations.json>");
}

const analysis = JSON.parse(await fs.readFile(inputPath, "utf8"));
const recommendationDocument = JSON.parse(await fs.readFile(recommendationsPath, "utf8"));
if (analysis.schemaVersion !== 4) {
  throw new Error(`Unsupported analysis schema: ${analysis.schemaVersion}. Run Analyze again with the current skill.`);
}
for (const [index, comparison] of (analysis.comparisons ?? []).entries()) {
  for (const field of ["baselineKeywords", "candidateKeywords", "addedKeywords", "removedKeywords"]) {
    if (!Array.isArray(comparison[field])) throw new Error(`Comparison ${index + 1} is missing keyword set: ${field}.`);
  }
  if (Object.hasOwn(comparison, "keyword")) throw new Error(`Comparison ${index + 1} uses the removed artificial keyword label field.`);
  const expectedAdded = comparison.candidateKeywords.filter((value) => !comparison.baselineKeywords.includes(value));
  const expectedRemoved = comparison.baselineKeywords.filter((value) => !comparison.candidateKeywords.includes(value));
  if (expectedAdded.join("\u001f") !== comparison.addedKeywords.join("\u001f") || expectedRemoved.join("\u001f") !== comparison.removedKeywords.join("\u001f")) {
    throw new Error(`Comparison ${index + 1} has inconsistent keyword sets.`);
  }
}
const shaderNames = [...new Set([...(analysis.variantSummaries ?? []), ...(analysis.variants ?? [])].map((row) => row.shader).filter(Boolean))];
const shaderName = analysis.run?.shader ?? shaderNames[0] ?? "";
if (!shaderName || shaderNames.some((name) => name !== shaderName)) {
  throw new Error("A workbook must contain exactly one Shader. Generate a separate workbook for each Shader.");
}
if (recommendationDocument.schemaVersion !== 1) {
  throw new Error(`Unsupported recommendation schema: ${recommendationDocument.schemaVersion}.`);
}
if (recommendationDocument.shader !== shaderName) {
  throw new Error(`Recommendation Shader mismatch: expected ${shaderName}, got ${recommendationDocument.shader}.`);
}
if (!Array.isArray(recommendationDocument.recommendations) || recommendationDocument.recommendations.length > 10) {
  throw new Error("Recommendations must be an array containing zero to ten evidence-backed items.");
}
const requiredRecommendationFields = ["priority", "expectedBenefit", "title", "comparison", "performanceEvidence", "codeEvidence", "proposedChange", "risk", "acceptance", "confidence"];
for (const [index, recommendation] of recommendationDocument.recommendations.entries()) {
  for (const field of requiredRecommendationFields) {
    if (typeof recommendation[field] !== "string" || recommendation[field].trim() === "") {
      throw new Error(`Recommendation ${index + 1} is missing required text field: ${field}.`);
    }
  }
  if (!/^P[0-3]$/.test(recommendation.priority)) throw new Error(`Recommendation ${index + 1} has invalid priority: ${recommendation.priority}.`);
  if (!["High", "Medium", "Low"].includes(recommendation.expectedBenefit)) throw new Error(`Recommendation ${index + 1} has invalid expected benefit: ${recommendation.expectedBenefit}.`);
  if (!Array.isArray(recommendation.sourceLocations) || recommendation.sourceLocations.length === 0 || recommendation.sourceLocations.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new Error(`Recommendation ${index + 1} must contain at least one source location.`);
  }
}

const workbook = Workbook.create();
const pathSpecs = [
  { label: "Total", key: "total_cycles" },
  { label: "Shortest", key: "shortest_path_cycles" },
  { label: "Longest", key: "longest_path_cycles" },
];
const stageSpecs = [
  { stage: "Vertex", maliVariant: "Position", suffix: "VS Position" },
  { stage: "Vertex", maliVariant: "Varying", suffix: "VS Varying" },
  { stage: "Fragment", maliVariant: "Main", suffix: "PS Main" },
];
const sectionColors = {
  Identity: "#1F4E78",
  Keywords: "#385D8A",
  Performance: "#0F6B78",
  Resources: "#5B4B8A",
  "Shader Flags": "#536878",
  Environment: "#5D6D7E",
};
const keywordOrderMaps = {
  multi: new Map((analysis.run?.multiCompileKeywordOrder ?? []).map((keyword, index) => [keyword, index])),
  material: new Map((analysis.run?.materialKeywordOrder ?? []).map((keyword, index) => [keyword, index])),
};

function splitKeywords(value) {
  return String(value ?? "").split(/\s+/).filter(Boolean);
}

function keywordTokens(row) {
  return [
    ...splitKeywords(row.multiCompileKeywords).map((value) => ({ value, source: "multi" })),
    ...splitKeywords(row.materialKeywords).map((value) => ({ value, source: "material" })),
  ];
}

function compareKeywordLists(left, right, order) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const leftRank = order.get(left[index]) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = order.get(right[index]) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return left.length - right.length;
}

function compareVariants(left, right) {
  return compareKeywordLists(splitKeywords(left.multiCompileKeywords), splitKeywords(right.multiCompileKeywords), keywordOrderMaps.multi)
    || compareKeywordLists(splitKeywords(left.materialKeywords), splitKeywords(right.materialKeywords), keywordOrderMaps.material)
    || String(left.variantId ?? "").localeCompare(String(right.variantId ?? ""));
}

function getVariantSummaries() {
  if ((analysis.variantSummaries ?? []).length > 0) {
    return [...analysis.variantSummaries].sort(compareVariants);
  }
  const summaries = [];
  for (const row of [...(analysis.variants ?? [])].sort(compareVariants)) {
    if (summaries.some((summary) => summary.variantId === row.variantId)) continue;
    const diagnostic = (analysis.diagnostics ?? []).find((item) => item.variantId === row.variantId && item.materialPath);
    summaries.push({ ...row, representativeMaterialPath: row.representativeMaterialPath ?? diagnostic?.materialPath ?? "" });
  }
  return summaries;
}

function getManifestBlocks() {
  const summaries = getVariantSummaries();
  const diagnostics = analysis.diagnostics ?? [];
  const variantIds = new Set(summaries.map((summary) => summary.variantId));
  const blocks = summaries.map((summary) => ({
    summary,
    diagnostics: diagnostics.filter((diagnostic) => diagnostic.variantId === summary.variantId),
  }));
  const unassigned = diagnostics.filter((diagnostic) => !diagnostic.variantId || !variantIds.has(diagnostic.variantId));
  if (unassigned.length > 0) blocks.push({ summary: null, diagnostics: unassigned });
  let startRow = 4;
  return blocks.map((block) => {
    const rowCount = Math.max(1, block.diagnostics.length);
    const result = { ...block, startRow, endRow: startRow + rowCount - 1 };
    startRow += rowCount;
    return result;
  });
}

function keywordText(tokens) {
  return tokens.map((token) => token.value).join(" | ");
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value--;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function propertyMap(properties = []) {
  return new Map(properties.map((property) => [property.name, property]));
}

function displayValue(value) {
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return value.join(", ");
  return value ?? null;
}

function uniqueDefinitions(rows, selector) {
  const definitions = new Map();
  for (const row of rows) {
    for (const item of selector(row) ?? []) {
      if (!definitions.has(item.name)) definitions.set(item.name, item);
    }
  }
  return [...definitions.values()];
}

function cycleValue(row, pathKey, pipeline) {
  const performance = row.malioc?.variant?.performance;
  const pipelineIndex = performance?.pipelines?.indexOf(pipeline) ?? -1;
  if (pipelineIndex < 0) return null;
  return performance?.[pathKey]?.cycle_count?.[pipelineIndex] ?? null;
}

function bottleneckCycles(row, pathKey) {
  const cycles = (row.malioc?.variant?.performance?.[pathKey]?.cycle_count ?? []).filter(Number.isFinite);
  return cycles.length > 0 ? Math.max(...cycles) : null;
}

function stageRecords() {
  return stageSpecs.flatMap((spec) => (analysis.variants ?? [])
    .filter((row) => row.stage === spec.stage && row.maliVariant === spec.maliVariant)
    .sort(compareVariants)
    .map((row, index) => ({ spec, row, startRow: 4 + index * 3, endRow: 6 + index * 3 })));
}

function performanceGuidance(pipelines) {
  const names = new Set(pipelines ?? []);
  if (names.has("load_store")) return ["当前受 Load/Store 吞吐限制.", "优先检查寄存器压力, 栈溢出, varying 数量和内存访问."];
  if (names.has("texture")) return ["当前受 Texture 吞吐限制.", "优先检查纹理采样次数和依赖采样链路."];
  if (names.has("varying")) return ["当前受 Varying 吞吐限制.", "优先检查插值器数量和 varying 带宽."];
  if ([...names].some((name) => name.startsWith("arith"))) return ["当前受算术吞吐限制.", "优先检查高密度算术, 类型转换和特殊函数路径."];
  return ["MaliOC 指向当前 Bound Pipeline.", "检查映射到该 Pipeline 的指令路径."];
}

const stageNames = {
  "VS Position": "VS Position",
  "VS Varying": "VS Varying",
  "PS Main": "PS Main",
};

const resourceNames = {
  work_registers_used: "工作寄存器",
  thread_occupancy: "线程占用率",
  uniform_registers_used: "Uniform 寄存器",
  stack_size: "栈大小",
  has_stack_spilling: "栈溢出",
  stack_spill_bytes: "栈溢出字节数",
  stack_alloca_bytes: "栈分配字节数",
  fp16_arithmetic: "FP16 算术占比",
};

const shaderFlagNames = {
  has_side_effects: "存在内存副作用",
  modifies_coverage: "修改 Coverage",
  uses_late_zs_test: "使用 Late ZS Test",
  uses_late_zs_update: "使用 Late ZS Update",
  reads_color_buffer: "读取颜色缓冲",
  has_uniform_computation: "存在 Uniform 计算",
};

const armSources = {
  product: "https://developer.arm.com/tools-and-software/graphics-and-gaming/mali-offline-compiler",
  userGuide: "https://documentation-service.arm.com/static/64d48d03d266282e0131d8f7?token=",
  resources: "https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/game-cost-budgeting-and-more-with-mobile-studio-2020-2",
  paths: "https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/accelerating-shader-programs-with-mali-offline-compiler-7",
};

const glossaryRows = [
  ["Performance", "Path", "Report row selector", "-", "当前行对应的控制流统计范围. Total, Shortest 和 Longest 每个变体各占一行.", "用于区分全部静态指令成本与可能执行路径, 三者不能相加.", armSources.paths],
  ["Performance", "Total", "total_cycles", "cycles", "MaliOC 对已编译程序中全部静态指令给出的 pipeline cycle cost.", "适合观察整体代码规模, 但不等同于一次运行时必经路径.", armSources.userGuide],
  ["Performance", "Shortest", "shortest_path_cycles", "cycles", "所有可分析控制流路径中估算成本最低的路径.", "与 Longest 的差距可反映分支路径成本离散程度.", armSources.paths],
  ["Performance", "Longest", "longest_path_cycles", "cycles", "所有可分析控制流路径中估算成本最高的路径.", "优先检查该路径的 Bound Pipelines 和高成本功能分支.", armSources.paths],
  ["Performance", "Bottleneck Cycles", "Derived: max(cycle_count)", "cycles", "本技能从当前 Path 的全部 pipeline cycle_count 中取最大值.", "这是报告派生字段, 用于快速排序, 不是 MaliOC 原生 JSON 字段.", armSources.product],
  ["Performance", "Bound Pipelines", "bound_pipelines", "-", "MaliOC 判断当前 Path 中成本最高并限制吞吐的 pipeline. 并列时可能返回多个.", "优先优化这些 pipeline 对应的工作, 再以相同编译条件复测.", armSources.product],
  ["Performance", "Arithmetic", "arith_total", "cycles", "Arithmetic total. 全部算术 pipeline 的聚合成本.", "用于判断整体算术压力, 细分原因继续查看 FMA, CVT 和 SFU.", armSources.userGuide],
  ["Performance", "Arith FMA", "arith_fma", "cycles", "Arithmetic Fused Multiply-Add pipeline 的估算成本.", "常见于乘加, 点积和线性代数运算.", armSources.userGuide],
  ["Performance", "Arith CVT", "arith_cvt", "cycles", "Arithmetic Convert pipeline 的估算成本.", "偏高时检查精度, 数据类型和显式或隐式类型转换.", armSources.userGuide],
  ["Performance", "Arith SFU", "arith_sfu", "cycles", "Arithmetic Special Function Unit pipeline 的估算成本.", "偏高时检查 reciprocal, sqrt, log, exp 和三角函数等特殊运算.", armSources.userGuide],
  ["Performance", "Load/Store", "load_store", "cycles", "Load/Store pipeline 的估算成本.", "偏高时检查寄存器溢出, buffer 或 uniform 访问, vertex attribute, varying fetch 和线程栈访问.", armSources.userGuide],
  ["Performance", "Texture", "texture", "cycles", "Texture pipeline 的估算成本.", "偏高时检查采样次数, 依赖采样链路和纹理访问模式.", armSources.product],
  ["Performance", "Varying", "varying", "cycles", "Varying pipeline 的估算成本.", "偏高时检查插值器数量, varying 精度和跨阶段传输量.", armSources.userGuide],
  ["Resources", "16-bit Arithmetic", "fp16_arithmetic", "%", "使用 16-bit 或更窄精度的算术操作百分比.", "在精度允许时提高该比例通常更利于 Mali GPU 执行效率.", armSources.resources],
  ["Resources", "Has Stack Spilling", "has_stack_spilling", "Boolean", "是否有一个或多个寄存器值被溢出到线程栈.", "True 表示存在额外内存流量, 应结合 Stack Spill Size 和 Load/Store 成本处理.", armSources.resources],
  ["Resources", "Stack Alloca Size", "stack_alloca_bytes", "bytes/thread", "显式栈分配使用的字节数.", "非零值会增加每线程栈占用, 应检查局部数组和编译器生成的栈对象.", armSources.userGuide],
  ["Resources", "Stack Size", "stack_size", "bytes/thread", "编译器为每个 shader 线程分配的总栈内存字节数.", "数值增长会增加栈内存压力, 需要结合 spill 和 alloca 判断来源.", armSources.userGuide],
  ["Resources", "Stack Spill Size", "stack_spill_bytes", "bytes/thread", "寄存器溢出到线程栈的字节数.", "应优先压低到 0, 因为 spill 会增加 Load/Store 工作和内存流量.", armSources.resources],
  ["Resources", "Thread Occupancy", "thread_occupancy", "%", "预计 shader core 可保持活动状态的线程占用率.", "较低值常与工作寄存器或栈压力有关, 但最终并行度仍需结合真实负载验证.", armSources.userGuide],
  ["Resources", "Uniform Registers Used", "uniform_registers_used", "registers", "使用的只读 uniform 寄存器数量.", "用于观察 uniform 数据压力, 不应与可读写 Work Registers 混淆.", armSources.userGuide],
  ["Resources", "Work Registers Used", "work_registers_used", "registers/thread", "每个线程使用的可读写工作寄存器数量.", "寄存器过多可能降低线程占用率或触发栈溢出.", armSources.resources],
  ["Shader Flags", "Has side-effects", "has_side_effects", "Boolean", "shader 是否存在应用可见的内存副作用.", "True 时不能进行 Early ZS test, 也不能被 Hidden Surface Removal 遮挡剔除.", armSources.userGuide],
  ["Shader Flags", "Has uniform computation", "has_uniform_computation", "Boolean", "shader 是否包含在同一 draw call 或 compute dispatch 的每次 invocation 中结果相同的计算.", "True 提示存在可外提或预计算机会, 需结合生成代码判断是否值得优化.", armSources.userGuide],
  ["Shader Flags", "Modifies coverage", "modifies_coverage", "Boolean", "fragment shader 是否可能修改 coverage mask.", "True 时不能进行 Early ZS update, 也不能作为 Hidden Surface Removal occluder.", armSources.userGuide],
  ["Shader Flags", "Reads color buffer", "reads_color_buffer", "Boolean", "shader 是否以程序方式读取 color buffer.", "True 时会被视为透明, 不能作为 Hidden Surface Removal occluder.", armSources.userGuide],
  ["Shader Flags", "Uses late ZS test", "uses_late_zs_test", "Boolean", "shader 是否使用 Late ZS test.", "被 Late ZS test 丢弃的 fragment 可能已经执行昂贵着色, 是潜在浪费.", armSources.userGuide],
  ["Shader Flags", "Uses late ZS update", "uses_late_zs_update", "Boolean", "shader 是否使用 Late ZS update.", "可能让同一坐标的后续 fragment 因深度依赖而等待.", armSources.userGuide],
];

function numberText(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "不可用";
}

function percentText(delta, baseline) {
  return Number.isFinite(delta) && Number.isFinite(baseline) && baseline !== 0 ? `${delta >= 0 ? "+" : ""}${(delta / baseline * 100).toFixed(1)}%` : "不可用";
}

function pipelineText(pipelines) {
  const labels = { load_store: "Load/Store", texture: "Texture", varying: "Varying" };
  return (pipelines ?? []).map((name) => labels[name] ?? name.replaceAll("arith_", "Arithmetic ")).join(", ") || "不可用";
}

function summarizePropertyChanges(left = [], right = []) {
  const leftMap = propertyMap(left);
  const rightMap = propertyMap(right);
  return [...new Set([...leftMap.keys(), ...rightMap.keys()])].flatMap((name) => {
    const before = leftMap.get(name)?.value;
    const after = rightMap.get(name)?.value;
    return Object.is(before, after) ? [] : [`${resourceNames[name] ?? name}: ${displayValue(before)} -> ${displayValue(after)}`];
  }).join("; ");
}

function summarizeFlagChanges(left = [], right = []) {
  const leftMap = propertyMap(left);
  const rightMap = propertyMap(right);
  return [...new Set([...leftMap.keys(), ...rightMap.keys()])].flatMap((name) => {
    const before = leftMap.get(name)?.value;
    const after = rightMap.get(name)?.value;
    return Object.is(before, after) ? [] : [`${shaderFlagNames[name] ?? name}: ${displayValue(before)} -> ${displayValue(after)}`];
  }).join("; ");
}

async function finalizeWorkbook(filePath) {
  const archive = await JSZip.loadAsync(await fs.readFile(filePath));
  for (let stageIndex = 0; stageIndex < stageSpecs.length; stageIndex++) {
    const sheetIndex = stageIndex + 3;
    const entryName = `xl/worksheets/sheet${sheetIndex}.xml`;
    const entry = archive.file(entryName);
    if (!entry) throw new Error(`Missing worksheet entry: ${entryName}`);
    const xml = await entry.async("string");
    let updated = xml.replace(
      /<x:sheetView([^>]*)\/>/,
      '<x:sheetView$1><x:pane xSplit="1" ySplit="3" topLeftCell="B4" activePane="bottomRight" state="frozen"/><x:selection pane="bottomRight" activeCell="B4" sqref="B4"/></x:sheetView>',
    );
    if (updated === xml) throw new Error(`Unable to freeze header rows in ${entryName}`);
    archive.file(entryName, updated);
  }
  const manifestEntryName = "xl/worksheets/sheet6.xml";
  const manifestEntry = archive.file(manifestEntryName);
  if (!manifestEntry) throw new Error(`Missing worksheet entry: ${manifestEntryName}`);
  const manifestXml = await manifestEntry.async("string");
  let updatedManifest = manifestXml.replace(
    /<x:sheetView([^>]*)\/>/,
    '<x:sheetView$1><x:pane xSplit="1" ySplit="3" topLeftCell="B4" activePane="bottomRight" state="frozen"/><x:selection pane="bottomRight" activeCell="B4" sqref="B4"/></x:sheetView>',
  );
  if (updatedManifest === manifestXml) throw new Error(`Unable to freeze header rows in ${manifestEntryName}`);
  archive.file(manifestEntryName, updatedManifest);
  const glossaryEntryName = "xl/worksheets/sheet7.xml";
  const glossaryEntry = archive.file(glossaryEntryName);
  if (!glossaryEntry) throw new Error(`Missing worksheet entry: ${glossaryEntryName}`);
  const glossaryXml = await glossaryEntry.async("string");
  const updatedGlossary = glossaryXml.replace(
    /<x:sheetView([^>]*)\/>/,
    '<x:sheetView$1><x:pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><x:selection pane="bottomLeft" activeCell="A5" sqref="A5"/></x:sheetView>',
  );
  if (updatedGlossary === glossaryXml) throw new Error(`Unable to freeze header rows in ${glossaryEntryName}`);
  archive.file(glossaryEntryName, updatedGlossary);
  await fs.writeFile(filePath, await archive.generateAsync({ type: "nodebuffer" }));
}

function addSummarySheet() {
  const sheet = workbook.worksheets.add("Summary");
  const producer = analysis.run?.malioc?.producer ?? {};
  const schema = analysis.run?.malioc?.schema ?? {};
  const sourcePaths = analysis.run?.sourcePaths ?? [];
  const entries = [
    ["Run Time", analysis.run?.runTime ? new Date(analysis.run.runTime) : null],
    ["Source Type", analysis.run?.sourceType ?? analysis.run?.scope ?? ""],
    ["Source Path(s)", sourcePaths.join("\n")],
    ["Shader", shaderName],
    ["Build Target", analysis.run?.buildTarget ?? ""],
    ["Compiler Platform", analysis.run?.compilerPlatform ?? ""],
    ["Mali Core", analysis.run?.maliCore ?? ""],
    ["SubShader", analysis.run?.subShader ?? 0],
    ["Pass", analysis.run?.pass ?? ""],
    ["Material Count", analysis.run?.materialCount ?? 0],
    ["Variant Count", analysis.run?.variantCount ?? 0],
    ["Comparison Count", analysis.run?.comparisonCount ?? (analysis.comparisons ?? []).length],
    ["Multi Compile Combination Count", analysis.run?.multiCompileCombinationCount ?? 0],
    ["Variant Combination Count", analysis.run?.syntheticCombinationCount ?? 0],
    ["Unity Version", analysis.run?.unityVersion ?? ""],
    ["MaliOC Version", analysis.run?.maliocVersion ?? ""],
    ["MaliOC Producer", producer.name ?? ""],
    ["MaliOC Producer Version", Array.isArray(producer.version) ? producer.version.join(".") : producer.version ?? ""],
    ["MaliOC Build", producer.build ?? ""],
    ["MaliOC Documentation", producer.documentation ?? ""],
    ["MaliOC Schema", schema.name ?? ""],
    ["MaliOC Schema Version", schema.version ?? ""],
    ["Status", analysis.status ?? ""],
  ];

  sheet.showGridLines = false;
  sheet.getRange("A1:B1").merge();
  sheet.getRange("A1:B1").values = [["Unity Shader Analysis"]];
  sheet.getRange("A1:B1").format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#17365D", size: 15 },
    verticalAlignment: "center",
  };
  sheet.getRange("A1:B1").format.rowHeight = 34;
  sheet.getRange("A3:B3").values = [["Field", "Value"]];
  sheet.getRange("A3:B3").format = {
    fill: sectionColors.Identity,
    font: { bold: true, color: "#FFFFFF", size: 10 },
    verticalAlignment: "center",
  };
  sheet.getRange(`A4:B${entries.length + 3}`).values = entries;
  sheet.getRange(`A4:B${entries.length + 3}`).format = {
    font: { size: 10 },
    verticalAlignment: "center",
    borders: { insideHorizontal: { style: "thin", color: "#E2E8F0" } },
  };
  sheet.getRange(`A4:B${entries.length + 3}`).format.rowHeight = 22;
  sheet.getRange(`B4:B${entries.length + 3}`).format.wrapText = true;
  const sourcePathRow = 4 + entries.findIndex(([label]) => label === "Source Path(s)");
  sheet.getRange(`A${sourcePathRow}:B${sourcePathRow}`).format.rowHeight = Math.min(150, Math.max(34, sourcePaths.length * 18));
  sheet.getRange(`A${4 + entries.findIndex(([label]) => label === "MaliOC Documentation")}:B${4 + entries.findIndex(([label]) => label === "MaliOC Documentation")}`).format.rowHeight = 34;
  sheet.getRange(`A4:A${entries.length + 3}`).format.font = { bold: true, color: "#334155", size: 10 };
  sheet.getRange(`B4:B${entries.length + 3}`).format.horizontalAlignment = "left";
  sheet.getRange("B4").format.numberFormat = "yyyy-mm-dd hh:mm:ss";
  sheet.getRange(`A3:B${entries.length + 3}`).format.borders = { preset: "outside", style: "thin", color: "#94A3B8" };
  sheet.getRange(`A1:A${entries.length + 3}`).format.columnWidth = 27;
  sheet.getRange(`B1:B${entries.length + 3}`).format.columnWidth = 72;
  sheet.freezePanes.freezeRows(3);
  return sheet;
}

function addStageSheet(spec) {
  const rows = (analysis.variants ?? [])
    .filter((row) => row.stage === spec.stage && row.maliVariant === spec.maliVariant)
    .sort(compareVariants);
  const reportRows = rows;
  const pipelineNames = [...new Set(reportRows.flatMap((row) => row.malioc?.variant?.performance?.pipelines ?? []))];
  const pipelineMetadata = new Map();
  for (const row of reportRows) {
    for (const pipeline of row.malioc?.hardware?.pipelines ?? []) pipelineMetadata.set(pipeline.name, pipeline);
  }
  const variantProperties = uniqueDefinitions(reportRows, (row) => row.malioc?.variant?.properties);
  const shaderProperties = uniqueDefinitions(reportRows, (row) => row.malioc?.properties);
  const tokensByVariant = reportRows.map(keywordTokens);
  const columns = [
    { key: "keywords", label: "Multi Compile -> Material Keywords", section: "Keywords", width: 72, merge: true },
  ];

  columns.push(
    { key: "path", label: "Path", section: "Performance", width: 12, merge: false },
    { key: "bottleneck", label: "Bottleneck Cycles", section: "Performance", width: 17, merge: false, formula: true },
  );
  columns.push({ key: "boundPipelines", label: "Bound Pipelines", section: "Performance", width: 28, merge: false });
  for (const pipeline of pipelineNames) {
    const metadata = pipelineMetadata.get(pipeline);
    columns.push({
      key: `pipeline:${pipeline}`,
      label: `${metadata?.display_name ?? pipeline} (${pipeline})`,
      section: "Performance",
      width: 19,
      merge: false,
      pipeline,
    });
  }
  for (const property of variantProperties) {
    columns.push({
      key: `variantProperty:${property.name}`,
      label: `${property.display_name} (${property.name})`,
      section: "Resources",
      width: 22,
      merge: true,
      property: property.name,
      propertyScope: "variant",
    });
  }
  for (const property of shaderProperties) {
    columns.push({
      key: `shaderProperty:${property.name}`,
      label: `${property.display_name} (${property.name})`,
      section: "Shader Flags",
      width: 22,
      merge: true,
      property: property.name,
      propertyScope: "shader",
    });
  }
  columns.push(
    { key: "driver", label: "Driver", section: "Environment", width: 16, merge: true },
    { key: "filename", label: "Filename", section: "Environment", width: 14, merge: true },
    { key: "architecture", label: "Architecture", section: "Environment", width: 16, merge: true },
    { key: "core", label: "Core", section: "Environment", width: 14, merge: true },
    { key: "revision", label: "Revision", section: "Environment", width: 12, merge: true },
    { key: "api", label: "API", section: "Environment", width: 14, merge: true },
    { key: "shaderType", label: "Shader Type", section: "Environment", width: 14, merge: true },
  );

  const sheetName = spec.suffix;
  const sheet = workbook.worksheets.add(sheetName);
  const lastColumn = columnName(columns.length - 1);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(3);
  sheet.freezePanes.freezeColumns(1);
  sheet.getRange(`A1:${lastColumn}1`).merge();
  sheet.getRange(`A1:${lastColumn}1`).values = [[spec.suffix]];
  sheet.getRange(`A1:${lastColumn}1`).format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#17365D", size: 15 },
    verticalAlignment: "center",
  };
  sheet.getRange(`A1:${lastColumn}1`).format.rowHeight = 34;

  let sectionStart = 0;
  while (sectionStart < columns.length) {
    let sectionEnd = sectionStart;
    while (sectionEnd + 1 < columns.length && columns[sectionEnd + 1].section === columns[sectionStart].section) sectionEnd++;
    const range = sheet.getRange(`${columnName(sectionStart)}2:${columnName(sectionEnd)}2`);
    if (sectionEnd > sectionStart) range.merge();
    range.values = [[columns[sectionStart].section]];
    range.format = {
      fill: sectionColors[columns[sectionStart].section],
      font: { bold: true, color: "#FFFFFF", size: 10 },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      borders: { preset: "all", style: "thin", color: "#D1D5DB" },
    };
    sectionStart = sectionEnd + 1;
  }
  sheet.getRange(`A3:${lastColumn}3`).values = [columns.map((column) => column.label)];
  for (let index = 0; index < columns.length; index++) {
    const column = columnName(index);
    sheet.getRange(`${column}3`).format = {
      fill: sectionColors[columns[index].section],
      font: { bold: true, color: "#FFFFFF", size: 9 },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "all", style: "thin", color: "#D1D5DB" },
    };
    sheet.getRange(`${column}1:${column}${Math.max(3 + reportRows.length * 3, 3)}`).format.columnWidth = columns[index].width;
  }
  sheet.getRange(`A2:${lastColumn}2`).format.rowHeight = 23;
  sheet.getRange(`A3:${lastColumn}3`).format.rowHeight = 42;

  const values = [];
  for (let rowIndex = 0; rowIndex < reportRows.length; rowIndex++) {
    const row = reportRows[rowIndex];
    const tokens = tokensByVariant[rowIndex];
    const variantPropertiesMap = propertyMap(row.malioc?.variant?.properties);
    const shaderPropertiesMap = propertyMap(row.malioc?.properties);
    for (let pathIndex = 0; pathIndex < pathSpecs.length; pathIndex++) {
      const pathSpec = pathSpecs[pathIndex];
      const performancePath = row.malioc?.variant?.performance?.[pathSpec.key];
      values.push(columns.map((column) => {
        if (column.merge && pathIndex > 0) return null;
        if (column.key === "keywords") return keywordText(tokens);
        if (column.key === "path") return pathSpec.label;
        if (column.key === "boundPipelines") return displayValue(performancePath?.bound_pipelines);
        if (column.pipeline) return cycleValue(row, pathSpec.key, column.pipeline);
        if (column.propertyScope === "variant") return displayValue(variantPropertiesMap.get(column.property)?.value);
        if (column.propertyScope === "shader") return displayValue(shaderPropertiesMap.get(column.property)?.value);
        if (column.key === "driver") return row.malioc?.driver ?? null;
        if (column.key === "filename") return row.malioc?.filename ?? null;
        if (column.key === "architecture") return row.malioc?.hardware?.architecture ?? null;
        if (column.key === "core") return row.malioc?.hardware?.core ?? null;
        if (column.key === "revision") return row.malioc?.hardware?.revision ?? null;
        if (column.key === "api") return row.malioc?.shader?.api ?? null;
        if (column.key === "shaderType") return row.malioc?.shader?.type ?? null;
        return null;
      }));
    }
  }

  if (values.length > 0) {
    const lastDataRow = 3 + values.length;
    sheet.getRange(`A4:${lastColumn}${lastDataRow}`).values = values;
    sheet.getRange(`A4:${lastColumn}${lastDataRow}`).format = {
      font: { size: 10, color: "#1F2937" },
      verticalAlignment: "center",
    };
    sheet.getRange(`B4:${lastColumn}${lastDataRow}`).format.horizontalAlignment = "right";
    const columnIndex = new Map(columns.map((column, index) => [column.key, index]));
    const pipelineStart = columnIndex.get(`pipeline:${pipelineNames[0]}`);
    const pipelineEnd = columnIndex.get(`pipeline:${pipelineNames[pipelineNames.length - 1]}`);
    const bottleneckIndex = columnIndex.get("bottleneck");

    for (let blockIndex = 0; blockIndex < reportRows.length; blockIndex++) {
      const row = reportRows[blockIndex];
      const startRow = 4 + blockIndex * 3;
      const endRow = startRow + 2;
      const fill = blockIndex % 2 === 0 ? "#F7FAFC" : "#EDF5FA";
      sheet.getRange(`A${startRow}:${lastColumn}${endRow}`).format.fill = fill;
      sheet.getRange(`A${startRow}:${lastColumn}${endRow}`).format.borders = {
        top: { style: "medium", color: "#94A3B8" },
        bottom: { style: "thin", color: "#CBD5E1" },
      };
      sheet.getRange(`A${startRow}:${lastColumn}${endRow}`).format.rowHeight = 22;
      for (let columnIndexValue = 0; columnIndexValue < columns.length; columnIndexValue++) {
        if (!columns[columnIndexValue].merge) continue;
        const column = columnName(columnIndexValue);
        sheet.getRange(`${column}${startRow}:${column}${endRow}`).merge();
        sheet.getRange(`${column}${startRow}:${column}${endRow}`).format.wrapText = true;
      }
      const keywordColumn = columnName(columnIndex.get("keywords"));
      sheet.getRange(`${keywordColumn}${startRow}:${keywordColumn}${endRow}`).format = {
        fill: "#EEF4FA",
        font: { bold: true, size: 8, color: "#334155" },
        horizontalAlignment: "left",
        verticalAlignment: "center",
        wrapText: true,
      };
      for (const label of ["Total", "Shortest", "Longest"]) {
        const rowOffset = pathSpecs.findIndex((pathSpec) => pathSpec.label === label);
        const pathColumn = columnName(columnIndex.get("path"));
        sheet.getRange(`${pathColumn}${startRow + rowOffset}`).format = {
          fill: label === "Total" ? "#FFF2CC" : label === "Shortest" ? "#E2F0D9" : "#FCE4D6",
          font: { bold: true, size: 9, color: "#374151" },
          horizontalAlignment: "center",
          verticalAlignment: "center",
        };
      }
      for (let pathIndex = 0; pathIndex < pathSpecs.length; pathIndex++) {
        const excelRow = startRow + pathIndex;
        const bottleneckColumn = columnName(bottleneckIndex);
        const pipelineRange = `${columnName(pipelineStart)}${excelRow}:${columnName(pipelineEnd)}${excelRow}`;
        sheet.getRange(`${bottleneckColumn}${excelRow}`).formulas = [[`=IF(COUNT(${pipelineRange})=0,"",MAX(${pipelineRange}))`]];
      }
    }

    for (const column of columns) {
      const index = columnIndex.get(column.key);
      const range = sheet.getRange(`${columnName(index)}4:${columnName(index)}${lastDataRow}`);
      if (column.key === "bottleneck" || column.pipeline) range.format.numberFormat = "0.00";
    }
  }

  return sheet;
}

function writeReportSection(sheet, startRow, title, items, color) {
  sheet.getRange(`A${startRow}:H${startRow}`).merge();
  sheet.getRange(`A${startRow}:H${startRow}`).values = [[title]];
  sheet.getRange(`A${startRow}:H${startRow}`).format = {
    fill: color,
    font: { bold: true, color: "#FFFFFF", size: 11 },
    verticalAlignment: "center",
  };
  sheet.getRange(`A${startRow}:H${startRow}`).format.rowHeight = 28;
  let row = startRow + 1;
  const reportItems = items.length > 0 ? items : [{ tag: "Info", title: "当前没有可报告的结论", body: "当前数据不足以形成可靠结论." }];
  for (const item of reportItems) {
    sheet.getRange(`A${row}:B${row}`).merge();
    sheet.getRange(`C${row}:H${row}`).merge();
    sheet.getRange(`A${row}:B${row}`).values = [[item.tag]];
    sheet.getRange(`C${row}:H${row}`).values = [[item.title]];
    const tagFill = item.tag.startsWith("P0") ? "#F8D7DA" : item.tag.startsWith("P1") ? "#FCE4D6" : item.tag.startsWith("P2") ? "#FFF2CC" : item.tag.startsWith("P3") ? "#E2F0D9" : "#D9EAF7";
    sheet.getRange(`A${row}:B${row}`).format = {
      fill: tagFill,
      font: { bold: true, color: "#374151", size: 9 },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      borders: { preset: "outside", style: "thin", color: "#CBD5E1" },
    };
    sheet.getRange(`C${row}:H${row}`).format = {
      fill: "#EAF2F8",
      font: { bold: true, color: "#17365D", size: 10 },
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "outside", style: "thin", color: "#CBD5E1" },
    };
    sheet.getRange(`A${row}:H${row}`).format.rowHeight = 28;
    row++;
    sheet.getRange(`A${row}:H${row}`).merge();
    sheet.getRange(`A${row}:H${row}`).values = [[item.body]];
    sheet.getRange(`A${row}:H${row}`).format = {
      fill: "#F8FAFC",
      font: { color: "#1F2937", size: 10 },
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "outside", style: "thin", color: "#CBD5E1" },
    };
    const bodyLines = String(item.body).split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 78)), 0);
    sheet.getRange(`A${row}:H${row}`).format.rowHeight = Math.min(220, Math.max(44, 22 + bodyLines * 18));
    row += 2;
  }
  return row;
}

function writeEvidenceSection(sheet, startRow, rows, boundaryText) {
  sheet.getRange(`A${startRow}:H${startRow}`).merge();
  sheet.getRange(`A${startRow}:H${startRow}`).values = [["性能证据"]];
  sheet.getRange(`A${startRow}:H${startRow}`).format = {
    fill: sectionColors.Performance,
    font: { bold: true, color: "#FFFFFF", size: 11 },
    verticalAlignment: "center",
  };
  sheet.getRange(`A${startRow}:H${startRow}`).format.rowHeight = 28;
  const headerRow = startRow + 1;
  sheet.getRange(`A${headerRow}:H${headerRow}`).values = [["口径", "对象", "阶段", "基线或最小值", "候选或最大值", "变化", "风险和上下文", "数据来源"]];
  sheet.getRange(`A${headerRow}:H${headerRow}`).format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#17365D", size: 9 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#CBD5E1" },
  };
  sheet.getRange(`A${headerRow}:H${headerRow}`).format.rowHeight = 32;
  let row = headerRow + 1;
  for (const item of rows) {
    sheet.getRange(`A${row}:H${row}`).values = [[item.scope, item.item, item.stage, item.baseline, item.candidate, item.delta, item.context, item.source]];
    sheet.getRange(`A${row}:H${row}`).format = {
      fill: item.scope === "关键字" ? "#F3F8FC" : item.scope === "变体组合" ? "#F8FAFC" : "#FFF8E7",
      font: { color: "#1F2937", size: 9 },
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "all", style: "thin", color: "#E2E8F0" },
    };
    sheet.getRange(`A${row}:C${row}`).format.horizontalAlignment = "left";
    sheet.getRange(`D${row}:F${row}`).format.numberFormat = "0.00";
    sheet.getRange(`D${row}:F${row}`).format.horizontalAlignment = "right";
    const contentLines = Math.max(
      Math.ceil(String(item.item ?? "").length / 22),
      Math.ceil(String(item.context ?? "").length / 44),
      Math.ceil(String(item.source ?? "").length / 28),
    );
    sheet.getRange(`A${row}:H${row}`).format.rowHeight = Math.min(160, Math.max(48, 20 + contentLines * 15));
    row++;
  }
  row++;
  sheet.getRange(`A${row}:H${row}`).merge();
  sheet.getRange(`A${row}:H${row}`).values = [[boundaryText]];
  sheet.getRange(`A${row}:H${row}`).format = {
    fill: "#EEF2F7",
    font: { italic: true, color: "#475569", size: 9 },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#CBD5E1" },
  };
  sheet.getRange(`A${row}:H${row}`).format.rowHeight = 68;
  return row + 2;
}

function addAnalysisSheet(sheet) {
  const records = stageRecords();
  const summaries = getVariantSummaries();
  const expectedVariants = summaries.length;
  const diagnostics = analysis.diagnostics ?? [];
  const errorCount = diagnostics.filter((item) => item.severity === "Error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "Warning").length;
  const stageCoverage = stageSpecs.map((spec) => records.filter((record) => record.spec.suffix === spec.suffix).length);
  const compileFailures = summaries.filter((summary) => summary.compileStatus === "Failed").length;
  const complete = errorCount === 0 && compileFailures === 0 && stageCoverage.every((count) => count === expectedVariants);
  const shaderFlagRows = [];
  for (const spec of stageSpecs) {
    const stage = records.filter((record) => record.spec.suffix === spec.suffix);
    const definitions = uniqueDefinitions(stage.map((record) => record.row), (row) => row.malioc?.properties);
    for (const definition of definitions) {
      const samples = stage.map((record) => ({ record, value: propertyMap(record.row.malioc?.properties).get(definition.name)?.value })).filter((sample) => sample.value != null);
      const trueSamples = samples.filter((sample) => sample.value === true);
      shaderFlagRows.push({
        definition,
        spec,
        trueCount: trueSamples.length,
      });
    }
  }

  const summaryMap = new Map(summaries.map((summary) => [summary.variantId, summary]));
  const recordMap = new Map(records.map((record) => [`${record.spec.suffix}|${record.row.variantId}`, record]));
  const comparisonDeltaRows = [];
  for (const comparison of analysis.comparisons ?? []) {
    const baseline = summaryMap.get(comparison.baselineVariantId);
    const candidate = summaryMap.get(comparison.candidateVariantId);
    if (!baseline || !candidate) continue;
    for (const spec of stageSpecs) {
      const baselineRecord = recordMap.get(`${spec.suffix}|${baseline.variantId}`);
      const candidateRecord = recordMap.get(`${spec.suffix}|${candidate.variantId}`);
      if (!baselineRecord || !candidateRecord) continue;
      const baselineTotal = bottleneckCycles(baselineRecord.row, "total_cycles");
      const candidateTotal = bottleneckCycles(candidateRecord.row, "total_cycles");
      comparisonDeltaRows.push({
        key: comparisonKey(comparison),
        displayName: comparisonName(comparison),
        sortKeyword: comparison.addedKeywords[0],
        comparison,
        spec,
        baselineRecord,
        candidateRecord,
        source: `${spec.suffix}!${baselineRecord.startRow}:${baselineRecord.endRow}; ${spec.suffix}!${candidateRecord.startRow}:${candidateRecord.endRow}`,
        totalDelta: baselineTotal == null || candidateTotal == null ? null : candidateTotal - baselineTotal,
        spillRegression: propertyMap(baselineRecord.row.malioc?.variant?.properties).get("has_stack_spilling")?.value === false && propertyMap(candidateRecord.row.malioc?.variant?.properties).get("has_stack_spilling")?.value === true,
      });
    }
  }
  comparisonDeltaRows.sort((left, right) => {
    const leftRank = keywordOrderMaps.multi.get(left.sortKeyword) ?? keywordOrderMaps.material.get(left.sortKeyword) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = keywordOrderMaps.multi.get(right.sortKeyword) ?? keywordOrderMaps.material.get(right.sortKeyword) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || stageSpecs.findIndex((spec) => spec.suffix === left.spec.suffix) - stageSpecs.findIndex((spec) => spec.suffix === right.spec.suffix);
  });
  const combinationNames = new Set((analysis.comparisons ?? [])
    .filter((item) => item.comparisonType === "SyntheticKeywordCombination")
    .map(comparisonName));
  const knownKeywords = new Set([...(analysis.run?.materialKeywordOrder ?? []), ...(analysis.run?.multiCompileKeywordOrder ?? [])]);
  for (const [index, recommendation] of recommendationDocument.recommendations.entries()) {
    const referencedKeywords = recommendation.comparison.match(/_[A-Z0-9_]+/g) ?? [];
    const unknownKeywords = referencedKeywords.filter((keyword) => !knownKeywords.has(keyword));
    if (unknownKeywords.length > 0) throw new Error(`Recommendation ${index + 1} references unknown keywords: ${unknownKeywords.join(", ")}.`);
  }
  const materialKeywordCount = analysis.run?.materialKeywordOrder?.length ?? 0;
  const syntheticCombinationCount = analysis.run?.syntheticCombinationCount ?? 0;

  const stageSummaries = stageSpecs.map((spec) => {
    const stage = records.filter((record) => record.spec.suffix === spec.suffix);
    const ranked = stage.filter((record) => bottleneckCycles(record.row, "total_cycles") != null)
      .sort((left, right) => bottleneckCycles(right.row, "total_cycles") - bottleneckCycles(left.row, "total_cycles") || compareVariants(left.row, right.row));
    const totals = ranked.map((record) => bottleneckCycles(record.row, "total_cycles"));
    const maximum = totals.length > 0 ? Math.max(...totals) : null;
    const minimum = totals.length > 0 ? Math.min(...totals) : null;
    const worst = ranked[0] ?? null;
    return {
      spec,
      stage,
      ranked,
      maximum,
      minimum,
      spread: maximum == null || minimum == null ? null : maximum - minimum,
      worst,
      ties: maximum == null ? [] : ranked.filter((record) => bottleneckCycles(record.row, "total_cycles") === maximum),
    };
  });

  const propertyStats = stageSpecs.map((spec) => {
    const stage = records.filter((record) => record.spec.suffix === spec.suffix);
    const values = (name) => stage.map((record) => propertyMap(record.row.malioc?.variant?.properties).get(name)?.value).filter((value) => value != null);
    const numericRange = (name) => {
      const samples = values(name).filter(Number.isFinite);
      return samples.length > 0 ? { minimum: Math.min(...samples), maximum: Math.max(...samples) } : { minimum: null, maximum: null };
    };
    return {
      spec,
      stage,
      spillCount: values("has_stack_spilling").filter(Boolean).length,
      spillBytes: numericRange("stack_spill_bytes"),
      workRegisters: numericRange("work_registers_used"),
      occupancy: numericRange("thread_occupancy"),
      stackSize: numericRange("stack_size"),
    };
  });

  const comparisonGroups = new Map();
  for (const delta of comparisonDeltaRows) {
    if (!comparisonGroups.has(delta.key)) comparisonGroups.set(delta.key, []);
    comparisonGroups.get(delta.key).push(delta);
  }
  const selectedComparisons = selectComparisonCandidates([...comparisonGroups.entries()].map(([key, deltas]) => {
    const valid = deltas.filter((delta) => Number.isFinite(delta.totalDelta));
    const worst = valid.reduce((best, delta) => !best || delta.totalDelta > best.totalDelta ? delta : best, null);
    const pairCount = new Set(deltas.map((delta) => `${delta.baselineRecord.row.variantId}|${delta.candidateRecord.row.variantId}`)).size;
    const comparisonTypes = new Set(deltas.map((delta) => delta.comparison?.comparisonType));
    if (comparisonTypes.size !== 1) throw new Error(`Comparison ${key} mixes comparison types.`);
    const comparisonType = [...comparisonTypes][0];
    const comparison = deltas[0].comparison;
    return {
      key,
      displayName: comparisonName(comparison),
      baselineKeywords: comparison.baselineKeywords,
      candidateKeywords: comparison.candidateKeywords,
      addedKeywords: comparison.addedKeywords,
      removedKeywords: comparison.removedKeywords,
      comparisonType,
      scope: comparisonType === "SyntheticKeywordCombination" ? "变体组合" : "关键字",
      deltas,
      pairCount,
      worst,
      worstDelta: worst?.totalDelta ?? -Infinity,
      spillRegression: deltas.some((delta) => delta.spillRegression),
    };
  }));
  const keywordCosts = selectedComparisons.filter((item) => item.scope === "关键字");
  const combinationCosts = selectedComparisons.filter((item) => item.scope === "变体组合");
  const selectedKeywordCount = new Set(selectedComparisons.flatMap((item) => item.addedKeywords)).size;

  const primaryStage = [...stageSummaries].filter((item) => item.maximum != null)
    .sort((left, right) => (right.spread ?? -Infinity) - (left.spread ?? -Infinity) || right.maximum - left.maximum)[0];
  const largestDeltaItem = [...keywordCosts].sort((left, right) => right.worstDelta - left.worstDelta)[0];
  const largestCombinationItem = [...combinationCosts].sort((left, right) => right.worstDelta - left.worstDelta)[0];
  const worstSpill = [...propertyStats].filter((item) => item.spillCount > 0)
    .sort((left, right) => (right.spillBytes.maximum ?? 0) - (left.spillBytes.maximum ?? 0))[0];
  const importantFlags = shaderFlagRows.filter((row) => row.trueCount > 0 && row.definition.name !== "has_uniform_computation");
  const stageRangeText = stageSummaries.map((item) => `${stageNames[item.spec.suffix]} ${numberText(item.minimum)}-${numberText(item.maximum)} cycles`).join(", ");
  const overallParts = [
    complete ? `本次 ${expectedVariants} 个变体的三个阶段数据完整.` : `本次报告不完整, 存在 ${errorCount} 个错误和 ${compileFailures} 个编译失败, 当前结论只能作为排查线索.`,
    `阶段范围为 ${stageRangeText}.`,
  ];
  if (primaryStage) overallParts.push(`${stageNames[primaryStage.spec.suffix]} 的变体组合差距最大, Total 相差 ${numberText(primaryStage.spread)} cycles, 可作为热点定位入口, 但不单独证明某个关键字是原因.`);
  if (worstSpill) overallParts.push(`${stageNames[worstSpill.spec.suffix]} 有 ${worstSpill.spillCount}/${worstSpill.stage.length} 个变体发生栈溢出, 最大 ${numberText(worstSpill.spillBytes.maximum, 0)} bytes, 应作为第一优先级处理.`);
  if (largestDeltaItem?.worst) overallParts.push(`最大单关键字开销为 ${largestDeltaItem.displayName} +${numberText(largestDeltaItem.worstDelta)} cycles.`);
  if (largestCombinationItem?.worst) overallParts.push(`最大变体组合开销为 ${largestCombinationItem.displayName} +${numberText(largestCombinationItem.worstDelta)} cycles, 该结果只归因于整个组合.`);
  if (warningCount > 0) overallParts.push(`另有 ${warningCount} 条编译警告, 具体内容见 Manifest.`);

  const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const benefitRank = { High: 0, Medium: 1, Low: 2 };
  const codeRecommendationItems = recommendationDocument.recommendations.map((item, index) => ({ item, index }))
    .sort((left, right) => priorityRank[left.item.priority] - priorityRank[right.item.priority]
      || benefitRank[left.item.expectedBenefit] - benefitRank[right.item.expectedBenefit]
      || left.index - right.index)
    .map(({ item }) => ({
      tag: item.priority,
      title: `${combinationNames.has(item.comparison) ? "变体组合 " : ""}${item.comparison}: ${item.title}`,
      body: [
        `性能证据: ${item.performanceEvidence}`,
        `源码位置: ${item.sourceLocations.join("; ")}`,
        `代码证据: ${item.codeEvidence}`,
        `修改方案: ${item.proposedChange}`,
        `风险: ${item.risk}`,
        `验收标准: ${item.acceptance}`,
        `预期收益: ${item.expectedBenefit}`,
        `置信度: ${item.confidence}`,
      ].join("\n"),
    }));

  if (codeRecommendationItems.length === 0) {
    codeRecommendationItems.push({ tag: "说明", title: "暂无有充分源码依据的可执行建议", body: "性能数据仍可用于排查; 空建议列表不代表没有优化空间. 请结合源码可用性和证据完整度解释限制." });
  }

  const loadStoreCount = records.filter((record) => (record.row.malioc?.variant?.performance?.total_cycles?.bound_pipelines ?? []).includes("load_store")).length;

  const variantCombinationRows = stageSummaries.filter((summary) => summary.worst).map((summary) => {
    const worst = summary.worst;
    const shortest = bottleneckCycles(worst.row, "shortest_path_cycles");
    const longest = bottleneckCycles(worst.row, "longest_path_cycles");
    const bound = worst.row.malioc?.variant?.performance?.total_cycles?.bound_pipelines ?? [];
    return {
      scope: "变体组合",
      item: keywordText(keywordTokens(worst.row)) || "无 Material Keyword",
      stage: stageNames[summary.spec.suffix],
      baseline: summary.minimum,
      candidate: summary.maximum,
      delta: summary.spread,
      context: `最慢变体只用于定位热点. Shortest ${numberText(shortest)}, Longest ${numberText(longest)}, Bound ${pipelineText(bound)}${summary.ties.length > 1 ? `, ${summary.ties.length} 个变体并列` : ""}.`,
      source: `${summary.spec.suffix}!${worst.startRow}:${worst.endRow}`,
    };
  });
  const keywordEvidenceRows = [];
  for (const item of [...selectedComparisons].sort((left, right) => right.worstDelta - left.worstDelta || String(left.displayName).localeCompare(String(right.displayName)))) {
    const worst = item.worst;
    const baselineTotal = bottleneckCycles(worst.baselineRecord.row, "total_cycles");
    const candidateTotal = bottleneckCycles(worst.candidateRecord.row, "total_cycles");
    const stageDeltas = stageSpecs.map((spec) => {
      const values = item.deltas.filter((delta) => delta.spec.suffix === spec.suffix && Number.isFinite(delta.totalDelta)).map((delta) => delta.totalDelta);
      if (values.length === 0) return null;
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const format = (value) => `${value >= 0 ? "+" : ""}${numberText(value)}`;
      return `${stageNames[spec.suffix]} ${minimum === maximum ? format(maximum) : `${format(minimum)} 至 ${format(maximum)}`}`;
    }).filter(Boolean).join(", ");
    const dependencies = worst.comparison?.dependencyChain ?? [];
    const multiContext = worst.comparison?.multiCompileContext ?? [];
    const baselineKeywords = worst.comparison.baselineKeywords;
    const candidateKeywords = worst.comparison.candidateKeywords;
    const resources = summarizePropertyChanges(worst.baselineRecord.row.malioc?.variant?.properties, worst.candidateRecord.row.malioc?.variant?.properties);
    const flags = summarizeFlagChanges(worst.baselineRecord.row.malioc?.properties, worst.candidateRecord.row.malioc?.properties);
    const row = {
      scope: item.scope,
      comparisonType: item.comparisonType,
      item: item.displayName,
      stage: stageNames[worst.spec.suffix],
      baseline: baselineTotal,
      candidate: candidateTotal,
      delta: worst.totalDelta,
      context: [`${item.pairCount} 组对照, 各阶段 ${stageDeltas}`, item.scope === "变体组合" ? `基线 ${baselineKeywords.join(" | ") || "全部为 OFF"} -> 候选 ${candidateKeywords.join(" | ") || "全部为 OFF"}` : null, item.spillRegression ? "至少一组对照新增 Stack Spill" : "未新增 Stack Spill", dependencies.length > 0 ? `依赖 ${dependencies.join(", ")}` : null, `上下文 ${multiContext.length > 0 ? multiContext.join(", ") : "全部为 OFF"}`, resources ? `资源 ${resources}` : null, flags ? `Flag ${flags}` : null].filter(Boolean).join(". "),
      source: worst.source,
    };
    (item.scope === "变体组合" ? variantCombinationRows : keywordEvidenceRows).push(row);
  }
  variantCombinationRows.sort((left, right) => (right.delta ?? Number.NEGATIVE_INFINITY) - (left.delta ?? Number.NEGATIVE_INFINITY) || String(left.item).localeCompare(String(right.item)));
  keywordEvidenceRows.sort((left, right) => (right.delta ?? Number.NEGATIVE_INFINITY) - (left.delta ?? Number.NEGATIVE_INFINITY) || String(left.item).localeCompare(String(right.item)));
  if (keywordEvidenceRows.some((row) => row.comparisonType === "SyntheticKeywordCombination")) throw new Error("Synthetic keyword combinations must not be rendered as single keywords.");
  const evidenceRows = [...variantCombinationRows, ...keywordEvidenceRows];
  for (const stats of propertyStats.filter((item) => item.spillCount > 0)) {
    evidenceRows.push({
      scope: "资源风险",
      item: "Stack Spill Bytes",
      stage: stageNames[stats.spec.suffix],
      baseline: stats.spillBytes.minimum,
      candidate: stats.spillBytes.maximum,
      delta: stats.spillBytes.maximum - stats.spillBytes.minimum,
      context: `${stats.spillCount}/${stats.stage.length} 个变体, Work Registers ${numberText(stats.workRegisters.minimum, 0)}-${numberText(stats.workRegisters.maximum, 0)}, Occupancy ${numberText(stats.occupancy.minimum, 0)}%-${numberText(stats.occupancy.maximum, 0)}%.`,
      source: `${stats.spec.suffix}!4:${3 + stats.stage.length * pathSpecs.length}`,
    });
  }
  if (importantFlags.length > 0) {
    evidenceRows.push({
      scope: "资源风险",
      item: "Shader Flag",
      stage: "多个阶段",
      baseline: null,
      candidate: null,
      delta: null,
      context: importantFlags.map((row) => `${stageNames[row.spec.suffix]} ${shaderFlagNames[row.definition.name] ?? row.definition.name}=${row.trueCount}/${records.filter((record) => record.spec.suffix === row.spec.suffix).length}`).join("; "),
      source: "阶段表 Shader Flags",
    });
  }
  if (loadStoreCount > 0) {
    evidenceRows.push({
      scope: "资源风险",
      item: "Load/Store Bound",
      stage: "全部阶段",
      baseline: null,
      candidate: `${loadStoreCount}/${records.length}`,
      delta: null,
      context: `${loadStoreCount}/${records.length} 个阶段结果受 Load/Store 限制. 优先检查寄存器压力, Stack Spill, varying 和数据搬运.`,
      source: "全部阶段表",
    });
  }

  sheet.showGridLines = false;
  sheet.getRange("A1:H1").merge();
  sheet.getRange("A1:H1").values = [["MaliOC 性能分析报告"]];
  sheet.getRange("A1:H1").format = { fill: "#D9EAF7", font: { bold: true, color: "#17365D", size: 16 }, verticalAlignment: "center" };
  sheet.getRange("A1:H1").format.rowHeight = 36;
  sheet.getRange("A2:H2").merge();
  sheet.getRange("A2:H2").values = [["报告合并为结论摘要, 优化清单和性能证据. 变体组合直接显示实际新增关键字, 关键字因果只来自单关键字 comparisons. 原始数据保留在后续阶段表中."]];
  sheet.getRange("A2:H2").format = { fill: "#EEF4FA", font: { italic: true, color: "#475569", size: 9 }, verticalAlignment: "center", wrapText: true };
  sheet.getRange("A2:H2").format.rowHeight = 34;
  const cards = [
    { range: "A4:B4", valueRange: "A5:B5", label: "分析状态", value: complete ? "完整" : "不完整", fill: complete ? "#E2F0D9" : "#F8D7DA" },
    { range: "C4:D4", valueRange: "C5:D5", label: "变体覆盖", value: `${expectedVariants} 变体 x ${stageSpecs.length} 阶段`, fill: "#D9EAF7" },
    { range: "E4:F4", valueRange: "E5:F5", label: "诊断", value: `${errorCount} 错误 / ${warningCount} 警告`, fill: errorCount > 0 ? "#F8D7DA" : "#FFF2CC" },
    { range: "G4:H4", valueRange: "G5:H5", label: "关键字覆盖", value: `${materialKeywordCount} 关键字 / ${syntheticCombinationCount} 组合`, fill: "#EDE7F6" },
  ];
  for (const card of cards) {
    sheet.getRange(card.range).merge();
    sheet.getRange(card.range).values = [[card.label]];
    sheet.getRange(card.range).format = { fill: sectionColors.Identity, font: { bold: true, color: "#FFFFFF", size: 9 }, horizontalAlignment: "center", verticalAlignment: "center" };
    sheet.getRange(card.valueRange).merge();
    sheet.getRange(card.valueRange).values = [[card.value]];
    sheet.getRange(card.valueRange).format = { fill: card.fill, font: { bold: true, color: "#334155", size: 11 }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "outside", style: "thin", color: "#94A3B8" } };
  }
  sheet.getRange("A4:H5").format.rowHeight = 24;
  let row = 7;
  row = writeReportSection(sheet, row, "结论摘要", [
    { tag: complete ? "结论" : "P0", title: complete ? "当前数据足以支持相对性能判断" : "当前数据不完整", body: overallParts.join(" ") },
    { tag: "口径", title: `保留 ${selectedComparisons.length} 个候选, 覆盖 ${selectedKeywordCount} 个实际关键字`, body: `其中 ${keywordCosts.length} 个单关键字候选, ${combinationCosts.length} 个变体组合候选. 候选由正向 Total 增量前 5 项和 Stack Spill 回归前 5 项取并集, 去重后最多 10 项. 两类分别按最大变化值从高到低排序. 组合成本只归因于整个组合.` },
  ], sectionColors.Identity);
  row = writeReportSection(sheet, row, "优化清单", codeRecommendationItems, "#9E480E");
  row = writeEvidenceSection(sheet, row, evidenceRows, "解释边界: MaliOC cycles 只用于相同编译条件下的静态相对比较. VS Position, VS Varying 和 PS Main 分阶段分析, 不相加. Material Count 不代表 DrawCall, 像素覆盖或运行时频率. 阶段范围只定位热点; 变体组合只归因于整个联合变化; 单关键字因果只使用单关键字 comparisons. 代码建议必须通过对应 comparison 和目标设备 GPU Profiler 验证.");

  const widths = [12, 24, 14, 14, 14, 12, 42, 28];
  for (let index = 0; index < widths.length; index++) sheet.getRange(`${columnName(index)}1:${columnName(index)}${row + 2}`).format.columnWidth = widths[index];
  return sheet;
}

function addManifestSheet() {
  const blocks = getManifestBlocks();
  const rows = [];
  for (const block of blocks) {
    const diagnostics = block.diagnostics.length > 0 ? block.diagnostics : [null];
    for (let index = 0; index < diagnostics.length; index++) {
      const diagnostic = diagnostics[index];
      rows.push([
        index === 0 && block.summary ? keywordText(keywordTokens(block.summary)) : null,
        index === 0 && block.summary ? block.summary.materialCount : null,
        index === 0 && block.summary ? block.summary.representativeMaterialPath ?? "" : null,
        diagnostic?.phase ?? "",
        diagnostic?.severity ?? "",
        diagnostic?.message ?? "",
      ]);
    }
  }
  const sheet = workbook.worksheets.add("Manifest");
  sheet.showGridLines = false;
  sheet.getRange("A1:F1").merge();
  sheet.getRange("A1:F1").values = [["Manifest"]];
  sheet.getRange("A1:F1").format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#17365D", size: 15 },
    verticalAlignment: "center",
  };
  sheet.getRange("A1:F1").format.rowHeight = 34;
  sheet.getRange("A2:C2").merge();
  sheet.getRange("A2:C2").values = [["Variant"]];
  sheet.getRange("D2:F2").merge();
  sheet.getRange("D2:F2").values = [["Diagnostics"]];
  sheet.getRange("A2:C2").format = {
    fill: sectionColors.Keywords,
    font: { bold: true, color: "#FFFFFF", size: 10 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: "#D1D5DB" },
  };
  sheet.getRange("D2:F2").format = {
    fill: sectionColors.Identity,
    font: { bold: true, color: "#FFFFFF", size: 10 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: "#D1D5DB" },
  };
  sheet.getRange("A3:C3").values = [["Multi Compile -> Material Keywords", "Material Count", "Compiled Material Path"]];
  sheet.getRange("D3:F3").values = [["Phase", "Severity", "Message"]];
  sheet.getRange("A3:C3").format = {
    fill: sectionColors.Keywords,
    font: { bold: true, color: "#FFFFFF", size: 9 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D1D5DB" },
  };
  sheet.getRange("D3:F3").format = {
    fill: sectionColors.Identity,
    font: { bold: true, color: "#FFFFFF", size: 9 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D1D5DB" },
  };
  sheet.getRange("A2:F3").format.rowHeight = 26;
  if (rows.length > 0) {
    const endRow = rows.length + 3;
    sheet.getRange(`A4:F${endRow}`).values = rows;
    sheet.getRange(`A4:F${endRow}`).format = {
      font: { size: 9 },
      verticalAlignment: "center",
      borders: { insideHorizontal: { style: "thin", color: "#E2E8F0" } },
    };
    sheet.getRange(`A4:A${endRow}`).format = {
      fill: "#EEF4FA",
      font: { bold: true, size: 8, color: "#334155" },
      horizontalAlignment: "left",
      verticalAlignment: "center",
      wrapText: true,
    };
    sheet.getRange(`B4:B${endRow}`).format.horizontalAlignment = "center";
    sheet.getRange(`C4:C${endRow}`).format = { horizontalAlignment: "left", verticalAlignment: "center", wrapText: true };
    sheet.getRange(`D4:E${endRow}`).format.horizontalAlignment = "center";
    sheet.getRange(`F4:F${endRow}`).format = { horizontalAlignment: "left", verticalAlignment: "center", wrapText: true };
    for (const block of blocks) {
      if (block.summary && block.endRow > block.startRow) {
        sheet.getRange(`A${block.startRow}:A${block.endRow}`).merge();
        sheet.getRange(`B${block.startRow}:B${block.endRow}`).merge();
        sheet.getRange(`C${block.startRow}:C${block.endRow}`).merge();
      }
      sheet.getRange(`A${block.startRow}:F${block.endRow}`).format.borders = {
        top: { style: "medium", color: "#94A3B8" },
        bottom: { style: "medium", color: "#94A3B8" },
      };
      const diagnostics = block.diagnostics.length > 0 ? block.diagnostics : [null];
      for (let index = 0; index < diagnostics.length; index++) {
        const diagnostic = diagnostics[index];
        const rowNumber = block.startRow + index;
        const messageLines = String(diagnostic?.message ?? "").split(/\r?\n/).length;
        sheet.getRange(`A${rowNumber}:F${rowNumber}`).format.rowHeight = diagnostic ? Math.min(92, Math.max(30, 12 + messageLines * 15)) : 24;
        if (!diagnostic) continue;
        sheet.getRange(`E${rowNumber}`).format = {
          fill: diagnostic.severity === "Error" ? "#F8D7DA" : diagnostic.severity === "Warning" ? "#FFF3CD" : "#D9EAF7",
          font: { bold: true, size: 9, color: "#374151" },
          horizontalAlignment: "center",
          verticalAlignment: "center",
        };
      }
    }
  }
  for (const [column, width] of Object.entries({ A: 62, B: 16, C: 62, D: 18, E: 12, F: 86 })) {
    sheet.getRange(`${column}1:${column}${Math.max(rows.length + 3, 3)}`).format.columnWidth = width;
  }
  return sheet;
}

function addGlossarySheet() {
  const sheet = workbook.worksheets.add("Glossary");
  const endRow = glossaryRows.length + 4;
  sheet.showGridLines = false;
  sheet.getRange("A1:G1").merge();
  sheet.getRange("A1:G1").values = [["MaliOC Glossary"]];
  sheet.getRange("A1:G1").format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#17365D", size: 15 },
    verticalAlignment: "center",
  };
  sheet.getRange("A1:G1").format.rowHeight = 34;
  sheet.getRange("A2:G2").merge();
  sheet.getRange("A2:G2").values = [["固定术语表. 定义来自 Arm Mali Offline Compiler 官方文档与 MaliOC JSON 字段说明, 所有报告保持一致."]];
  sheet.getRange("A2:G2").format = {
    fill: "#EEF4FA",
    font: { color: "#475569", size: 9 },
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange("A2:G2").format.rowHeight = 30;
  sheet.getRange("A4:G4").values = [["Category", "Parameter", "JSON Field", "Unit", "Meaning", "Interpretation", "Official Source"]];
  sheet.getRange("A4:G4").format = {
    fill: sectionColors.Identity,
    font: { bold: true, color: "#FFFFFF", size: 10 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D1D5DB" },
  };
  sheet.getRange(`A5:G${endRow}`).values = glossaryRows;
  sheet.getRange(`A5:G${endRow}`).format = {
    font: { size: 9 },
    verticalAlignment: "center",
    wrapText: true,
    borders: { insideHorizontal: { style: "thin", color: "#E2E8F0" } },
  };
  sheet.getRange(`A5:A${endRow}`).format.font = { bold: true, color: "#FFFFFF", size: 9 };
  for (let index = 0; index < glossaryRows.length; index++) {
    const row = index + 5;
    sheet.getRange(`A${row}`).format.fill = sectionColors[glossaryRows[index][0]];
    sheet.getRange(`A${row}:G${row}`).format.rowHeight = 48;
  }
  sheet.getRange(`B5:D${endRow}`).format.horizontalAlignment = "left";
  sheet.getRange(`E5:G${endRow}`).format.horizontalAlignment = "left";
  for (const [column, width] of Object.entries({ A: 16, B: 27, C: 29, D: 14, E: 55, F: 61, G: 58 })) {
    sheet.getRange(`${column}1:${column}${endRow}`).format.columnWidth = width;
  }
  sheet.freezePanes.freezeRows(4);
  return sheet;
}

const sheetNames = [addSummarySheet().name];
const analysisSheet = workbook.worksheets.add("Analysis");
sheetNames.push(analysisSheet.name);
for (const spec of stageSpecs) sheetNames.push(addStageSheet(spec).name);
sheetNames.push(addManifestSheet().name);
sheetNames.push(addGlossarySheet().name);
addAnalysisSheet(analysisSheet);

const inspect = await workbook.inspect({
  kind: "workbook,sheet",
  maxChars: 5000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});

await fs.mkdir(previewDir, { recursive: true });
for (const sheetName of sheetNames) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  const filename = sheetName.toLowerCase().replaceAll(" ", "-") + ".png";
  await fs.writeFile(path.join(previewDir, filename), new Uint8Array(await preview.arrayBuffer()));
}

await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await finalizeWorkbook(outputPath);

console.log(JSON.stringify({
  outputPath: path.resolve(outputPath),
  previewDir: path.resolve(previewDir),
  sheets: sheetNames,
  inspect: inspect.ndjson,
  formulaErrors: formulaErrors.ndjson,
}, null, 2));
