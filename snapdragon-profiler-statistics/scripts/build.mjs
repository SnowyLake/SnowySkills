import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const METRICS = ["ALU / Fragment", "ALU / Vertex", "EFU / Fragment", "EFU / Vertex"];
const PASS_ALIASES = new Map([
  ["CustomDepthStencilCommandBuffer", "CustomDepthStencil"],
  ["Camera.RenderSkybox", "Skybox"],
  ["WaterTransparentCommandBuffer", "WaterTransparent"],
  ["ComputeShaderScreenSpaceReflection", "SSPR"],
  ["WaterCommandBuffer", "Water"],
  ["WaterFormWaveCommandBuffer", "WaterFormWave"],
  ["CharacterEyeThroughHairCommandBuffer", "CharacterEyeThroughHair"],
  ["UberFxCommandBuffer", "UberFX"],
  ["OverlayFXCommandBuffer", "OverlayFX"],
  ["SelectEffectsCommandBuffer", "SelectEffects"],
  ["Render PostProcessing Effects", "PostProcess"],
  ["UGUI.Rendering.RenderOverlays", "RenderOverlays"],
]);
const NESTED_MARKERS = new Set(["Shadows.DrawSRPBatcher", "Canvas.RenderSubBatch", "SMAA", "UberPostProcess", "Bloom"]);
const STANDARD_PASSES = new Map([
  ["MainCamera", [
    "UpdateReflectionProbeAtlas", "MainLightShadow", "DepthPrepass", "ColorGradingLUT", "CopyDepth", "DrawOpaqueObjects", "CustomDepthStencil", "Skybox",
    "WaterTransparent", "Decal Screen Space Render", "CopyColor", "SSPR", "Water", "WaterFormWave", "DrawTransparentObjects", "CharacterEyeThroughHair",
    "UberFX", "OverlayFX", "SelectEffects", "PostProcess", "HUDRenderObjects", "HUD Instanced Direct",
  ]],
  ["UICamera", ["DrawTransparentObjects", "FinalBlit", "RenderOverlays", "GUI.Repaint", "GUITexture.Draw"]],
]);

function parseArgs(argv) {
  const options = { scenes: [], checkOnly: false };
  let scene;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--check-only") {
      options.checkOnly = true;
    } else if (argument === "--output" || argument === "--preview-dir") {
      if (!value) throw new Error(`${argument} requires a value`);
      options[argument === "--output" ? "output" : "previewDir"] = value;
      index += 1;
    } else if (argument === "--scene") {
      if (!value) throw new Error("--scene requires a value");
      scene = { name: value };
      options.scenes.push(scene);
      index += 1;
    } else if (argument === "--clocks" || argument === "--alu") {
      if (!scene || !value) throw new Error(`${argument} must follow --scene and requires a value`);
      const key = argument === "--clocks" ? "clocksFile" : "aluFile";
      if (scene[key]) throw new Error(`${argument} was provided more than once for ${scene.name}`);
      scene[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.scenes.length) throw new Error("At least one --scene is required");
  if (!options.checkOnly && !options.output) throw new Error("--output is required unless --check-only is used");
  return options;
}

async function readCsv(file) {
  const csv = await fs.readFile(file, "utf8");
  const workbook = await Workbook.fromCSV(csv, { sheetName: "Data" });
  const values = workbook.worksheets.getItem("Data").getUsedRange(true).values;
  if (!values?.length) throw new Error("CSV is empty");
  return { file, headers: values[0].map((value) => String(value ?? "").trim()), rows: values.slice(1) };
}

function column(data, name) {
  return data.headers.indexOf(name);
}

function requireColumns(data, names) {
  const missing = names.filter((name) => column(data, name) < 0);
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
}

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cameraRanges(data) {
  const nameIndex = column(data, "Name");
  const cameras = [];
  for (let index = 0; index < data.rows.length; index += 1) {
    const match = text(data.rows[index][nameIndex]).match(/^UniversalRenderPipeline\.RenderSingleCameraInternal:\s*(.+)$/);
    if (match) cameras.push({ name: match[1].trim(), start: index });
  }
  for (let index = 0; index < cameras.length; index += 1) {
    const nextCamera = cameras[index + 1]?.start ?? data.rows.length;
    const playerEnd = data.rows.findIndex((row, rowIndex) => rowIndex > cameras[index].start && text(row[nameIndex]) === "PlayerEndOfFrame");
    cameras[index].end = playerEnd >= 0 && playerEnd < nextCamera ? playerEnd : nextCamera;
  }
  return cameras;
}

function isNestedOrContainer(name) {
  return !name
    || name === "Camera.Render"
    || name === "WaitForRenderJobs"
    || name.startsWith("ScriptableRenderer.Execute:")
    || name.startsWith("UniversalRenderPipeline.RenderSingleCameraInternal:")
    || name.startsWith("RenderLoop.")
    || NESTED_MARKERS.has(name);
}

function directMarkers(data, camera, valueColumns) {
  const idIndex = column(data, "ID");
  const nameIndex = column(data, "Name");
  const markers = [];
  for (let index = camera.start + 1; index < camera.end; index += 1) {
    const row = data.rows[index];
    const name = text(row[nameIndex]);
    if (text(row[idIndex]) !== "" || isNestedOrContainer(name) || /^(gl|egl|vk)/i.test(name)) continue;
    if (!valueColumns.some((valueColumn) => number(row[valueColumn]) !== null)) continue;
    markers.push({ index, name, row });
  }
  return markers;
}

function extractClocks(data) {
  requireColumns(data, ["ID", "Name", "Clocks"]);
  const clocksIndex = column(data, "Clocks");
  const cameras = cameraRanges(data);
  if (!cameras.length) throw new Error("No camera range markers were found");
  const passes = [];
  let directPassCount = 0;
  for (const camera of cameras) {
    const cameraName = camera.name.replace(/\s+/g, "");
    const merged = new Map();
    for (const marker of directMarkers(data, camera, [clocksIndex])) {
      directPassCount += 1;
      const label = PASS_ALIASES.get(marker.name) ?? marker.name;
      merged.set(label, (merged.get(label) ?? 0) + (number(marker.row[clocksIndex]) ?? 0));
    }
    const standard = STANDARD_PASSES.get(cameraName) ?? [];
    for (const pass of standard) passes.push({ camera: cameraName, pass, clocks: (merged.get(pass) ?? 0) / 10000 });
    for (const [pass, clocks] of merged) if (!standard.includes(pass)) passes.push({ camera: cameraName, pass, clocks: clocks / 10000 });
  }
  if (!directPassCount) throw new Error("No direct camera passes with Clocks values were found");
  return { passes, cameraCount: cameras.length };
}

function extractAluEfu(data) {
  requireColumns(data, ["ID", "Name", ...METRICS]);
  const idIndex = column(data, "ID");
  const nameIndex = column(data, "Name");
  const metricIndexes = METRICS.map((metric) => column(data, metric));
  const cameras = cameraRanges(data);
  if (!cameras.length) throw new Error("No camera range markers were found");
  const cameraDetails = cameras.map((camera) => ({ camera, markers: directMarkers(data, camera, metricIndexes) }));
  const namedMain = cameraDetails.filter(({ camera }) => camera.name.replace(/\s+/g, "").toLowerCase() === "maincamera");
  const candidates = namedMain.length ? namedMain : cameraDetails.filter(({ markers }) => markers.some(({ name }) => name === "DrawOpaqueObjects") && markers.some(({ name }) => name === "DrawTransparentObjects"));
  if (candidates.length > 1) throw new Error("Ambiguous main camera: multiple camera ranges match. Export one intended range.");
  const main = candidates[0];
  if (!main) throw new Error("No main camera containing Opaque and Transparent passes was found");

  const targets = ["DrawOpaqueObjects", "DrawTransparentObjects"].map((targetName) => {
    const markerPosition = main.markers.findIndex(({ name }) => name === targetName);
    if (markerPosition < 0) throw new Error(`Missing main camera pass: ${targetName}`);
    const marker = main.markers[markerPosition];
    const end = main.markers[markerPosition + 1]?.index ?? main.camera.end;
    const draws = data.rows.slice(marker.index + 1, end).filter((row) => text(row[idIndex]) !== "" && /^gl.*Draw/i.test(text(row[nameIndex])));
    if (!draws.length) throw new Error(`No gl*Draw* rows were found in ${targetName}`);
    return { marker, draws };
  });

  const draws = targets.flatMap(({ draws: targetDraws }) => targetDraws);
  const stats = metricIndexes.map((metricIndex, metricPosition) => {
    const values = draws.map((row) => number(row[metricIndex])).filter((value) => value !== null);
    if (!values.length) throw new Error(`No values were found for ${METRICS[metricPosition]}`);
    const actual = values.reduce((sum, value) => sum + value, 0);
    const expected = targets.reduce((sum, { marker }) => sum + (number(marker.row[metricIndex]) ?? 0), 0);
    const tolerance = Math.max(0.11, values.length * 0.005 + 0.02);
    if (Math.abs(actual - expected) > tolerance) throw new Error(`${METRICS[metricPosition]} draw sum does not match pass totals within rounding tolerance`);
    return [METRICS[metricPosition], Math.max(...values), Math.min(...values), actual / values.length];
  });
  return { stats, drawCount: draws.length, camera: main.camera.name };
}

async function analyzeScene(scene) {
  const analysis = { name: scene.name, clocksFile: scene.clocksFile, aluFile: scene.aluFile };
  if (scene.clocksFile) {
    try {
      analysis.clocks = extractClocks(await readCsv(scene.clocksFile));
    } catch (error) {
      analysis.clocksError = error.message;
    }
  } else analysis.clocksError = "Clocks CSV was not provided";
  if (scene.aluFile) {
    try {
      analysis.aluEfu = extractAluEfu(await readCsv(scene.aluFile));
    } catch (error) {
      analysis.aluEfuError = error.message;
    }
  } else analysis.aluEfuError = "ALU/EFU CSV was not provided";
  return analysis;
}

function safeSheetName(name, usedNames) {
  const base = text(name).replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "Scene";
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const postfix = `_${suffix}`;
    candidate = `${base.slice(0, 31 - postfix.length)}${postfix}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function applyPanelTitle(sheet, range, color, border) {
  sheet.getRange(range).merge();
  sheet.getRange(range).format = { fill: color, font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", borders: border };
}

function writeClockPanel(sheet, analysis) {
  const endRow = 4 + analysis.clocks.passes.length;
  sheet.getRange("A2:D2").values = [["Total Pass Clocks", null, null, null]];
  sheet.getRange("A3:D3").values = [["Camera", "Pass", "Clocks", "百分比"]];
  sheet.getRange("A4:B4").values = [["All", "Total"]];
  sheet.getRange(`A5:C${endRow}`).values = analysis.clocks.passes.map(({ camera, pass, clocks }) => [camera, pass, clocks]);
  sheet.getRange("C4").formulas = [[`=SUM(C5:C${endRow})`]];
  sheet.getRange("D4").values = [[1]];
  sheet.getRange("D5").formulas = [["=IF($C$4=0,0,C5/$C$4)"]];
  sheet.getRange(`D5:D${endRow}`).fillDown();
  return endRow;
}

function writeStatsPanel(sheet, analysis, firstColumn) {
  const columns = firstColumn === "A" ? ["A", "B", "C", "D"] : ["F", "G", "H", "I"];
  sheet.getRange(`${columns[0]}2:${columns[3]}2`).values = [["Opaque + Transparent ALU / EFU", null, null, null]];
  sheet.getRange(`${columns[0]}3:${columns[3]}3`).values = [[null, "Max", "Min", "Avg"]];
  sheet.getRange(`${columns[0]}4:${columns[3]}7`).values = analysis.aluEfu.stats;
  return columns;
}

function styleSheet(sheet, analysis, clockEndRow, statsColumns, sourceRow) {
  const navy = "#1F4E78";
  const paleBlue = "#D9EAF7";
  const paleGray = "#F2F2F2";
  const border = { preset: "all", style: "thin", color: "#7F7F7F" };
  const bothPanels = Boolean(analysis.clocks && analysis.aluEfu);
  const lastColumn = bothPanels ? "I" : "D";
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(2);
  sheet.getRange(`A1:${lastColumn}1`).merge();
  sheet.getRange("A1").values = [[`${analysis.sheetName} - Snapdragon Profiler`]];
  sheet.getRange(`A1:${lastColumn}1`).format = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 16 }, horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange(`A1:${lastColumn}1`).format.rowHeight = 30;

  if (analysis.clocks) {
    applyPanelTitle(sheet, "A2:D2", navy, border);
    sheet.getRange("A3:D3").format = { fill: paleBlue, font: { bold: true }, horizontalAlignment: "center", borders: border };
    sheet.getRange(`A4:D${clockEndRow}`).format.borders = border;
    sheet.getRange(`A4:B${clockEndRow}`).format.font = { bold: true };
    sheet.getRange(`C4:C${clockEndRow}`).format.numberFormat = "#,##0.0\"W\"";
    sheet.getRange(`D4:D${clockEndRow}`).format.numberFormat = "0.0%";
    sheet.getRange(`C4:D${clockEndRow}`).format.horizontalAlignment = "right";
    sheet.getRange("A4:D4").format = { fill: paleGray, font: { bold: true }, borders: border };
    sheet.getRange("A:A").format.columnWidth = 14;
    sheet.getRange("B:B").format.columnWidth = 30;
    sheet.getRange("C:C").format.columnWidth = 14;
    sheet.getRange("D:D").format.columnWidth = 12;
  }

  if (analysis.aluEfu) {
    const [first, second, , fourth] = statsColumns;
    applyPanelTitle(sheet, `${first}2:${fourth}2`, navy, border);
    sheet.getRange(`${first}3:${fourth}3`).format = { fill: paleBlue, font: { bold: true }, horizontalAlignment: "center", borders: border };
    sheet.getRange(`${first}4:${fourth}7`).format.borders = border;
    sheet.getRange(`${first}4:${fourth}7`).format.numberFormat = "0.00";
    sheet.getRange(`${first}4:${first}7`).format.font = { bold: true };
    sheet.getRange(`${second}4:${fourth}7`).format.horizontalAlignment = "right";
    sheet.getRange(`${first}:${first}`).format.columnWidth = 20;
    sheet.getRange(`${second}:${fourth}`).format.columnWidth = 13;
  }
  if (bothPanels) sheet.getRange("E:E").format.columnWidth = 3;
  sheet.getRange(`A${sourceRow}:${lastColumn}${sourceRow}`).merge();
  sheet.getRange(`A${sourceRow}:${lastColumn}${sourceRow}`).format = { fill: paleGray, font: { italic: true, color: "#595959", size: 9 } };
}

function addSceneSheet(workbook, analysis, usedNames) {
  analysis.sheetName = safeSheetName(analysis.name, usedNames);
  const sheet = workbook.worksheets.add(analysis.sheetName);
  const clockEndRow = analysis.clocks ? writeClockPanel(sheet, analysis) : 0;
  const statsColumns = analysis.aluEfu ? writeStatsPanel(sheet, analysis, analysis.clocks ? "F" : "A") : null;
  const sourceRow = Math.max(clockEndRow, analysis.aluEfu ? 7 : 0) + 2;
  const sourceFiles = [analysis.clocksFile, analysis.aluFile].filter(Boolean).map((file) => path.basename(file)).join("; ");
  const scopes = [analysis.clocks ? "Clocks 以万为单位" : null, analysis.aluEfu ? `ALU/EFU 合并 ${analysis.aluEfu.camera} Opaque 与 Transparent 内全部 gl*Draw* 调用` : null].filter(Boolean).join("; ");
  sheet.getRange(`A${sourceRow}`).values = [[`来源: ${sourceFiles}. ${scopes}.`]];
  styleSheet(sheet, analysis, clockEndRow, statsColumns, sourceRow);
  analysis.renderRange = `A1:${analysis.clocks && analysis.aluEfu ? "I" : "D"}${sourceRow}`;
}

function diagnostics(analyses, output) {
  return {
    output,
    scenes: analyses.map((analysis) => ({
      scene: analysis.name,
      sheet: analysis.sheetName,
      clocks: analysis.clocks ? { status: "included", cameras: analysis.clocks.cameraCount, passes: analysis.clocks.passes.length } : { status: "omitted", reason: analysis.clocksError },
      aluEfu: analysis.aluEfu ? { status: "included", mainCamera: analysis.aluEfu.camera, draws: analysis.aluEfu.drawCount } : { status: "omitted", reason: analysis.aluEfuError },
    })),
  };
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const analyses = [];
  for (const scene of options.scenes) analyses.push(await analyzeScene(scene));
  const valid = analyses.filter((analysis) => analysis.clocks || analysis.aluEfu);
  if (options.checkOnly || !valid.length) {
    console.log(JSON.stringify(diagnostics(analyses), null, 2));
    if (!valid.length) process.exitCode = 2;
    return;
  }

  const workbook = Workbook.create();
  const usedNames = new Set();
  for (const analysis of valid) addSceneSheet(workbook, analysis, usedNames);
  const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
  if (!formulaErrors.ndjson.includes("matched 0 entries")) throw new Error(`Formula error scan failed: ${formulaErrors.ndjson}`);

  if (options.previewDir) await fs.mkdir(options.previewDir, { recursive: true });
  for (const analysis of valid) {
    await workbook.inspect({ kind: "table", range: `${analysis.sheetName}!${analysis.renderRange}`, include: "values,formulas", tableMaxRows: 40, tableMaxCols: 9, maxChars: 8000 });
    const preview = await workbook.render({ sheetName: analysis.sheetName, range: analysis.renderRange, scale: 1.5, format: "png" });
    if (options.previewDir) await fs.writeFile(path.join(options.previewDir, `${analysis.sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
  }

  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(options.output);
  console.log(JSON.stringify(diagnostics(analyses, path.resolve(options.output)), null, 2));
}

async function runSelfTest() {
  const assert = (await import("node:assert/strict")).default;
  const marker = "UniversalRenderPipeline.RenderSingleCameraInternal: ";
  const clocks = { headers: ["ID", "Name", "Clocks"], rows: [["", `${marker}MainCamera`, 100]] };
  assert.throws(() => extractClocks(clocks), /No direct camera passes/);
  clocks.rows.push(["", "DrawOpaqueObjects", 0], [1, "glDrawElements", 500], ["", "Bloom", 100]);
  assert.equal(extractClocks(clocks).passes.find((item) => item.pass === "DrawOpaqueObjects").clocks, 0);
  assert.equal(extractClocks(clocks).passes.reduce((sum, item) => sum + item.clocks, 0), 0);
  clocks.rows.push(["", "DrawOpaqueObjects", 20000]);
  assert.equal(extractClocks(clocks).passes.find((item) => item.pass === "DrawOpaqueObjects").clocks, 2);
  const alu = {
    headers: ["ID", "Name", ...METRICS],
    rows: [
      ["", `${marker}MainCamera`],
      ["", "DrawOpaqueObjects", 2, 2, 2, 2],
      [1, "glDrawElements", 0, 0, 0, 0],
      [2, "glDrawElements", 2, 2, 2, 2],
      [3, "glDrawElements", "", "", "", ""],
      ["", "DrawTransparentObjects", 4, 4, 4, 4],
      [4, "glDrawArrays", 4, 4, 4, 4],
    ],
  };
  assert.deepEqual(extractAluEfu(alu).stats[0], [METRICS[0], 4, 0, 2]);
  const badTotals = structuredClone(alu);
  badTotals.rows[1][2] = 20;
  assert.throws(() => extractAluEfu(badTotals), /rounding tolerance/);
  const ambiguous = structuredClone(alu);
  ambiguous.rows[0][1] = `${marker}WorldCamera`;
  ambiguous.rows.push(...structuredClone(ambiguous.rows));
  assert.throws(() => extractAluEfu(ambiguous), /Ambiguous main camera/);
  assert.equal(extractAluEfu({ ...alu, rows: [...alu.rows, ...ambiguous.rows] }).camera, "MainCamera");
  const usedNames = new Set();
  assert.equal(safeSheetName("Scene", usedNames), "Scene");
  assert.equal(safeSheetName("scene", usedNames), "scene_2");
  assert.equal(safeSheetName("a".repeat(40), usedNames).length, 31);
  console.log("Snapdragon statistics self-test passed");
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
