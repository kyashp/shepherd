import { mkdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./test-app.mjs";

const VIEWPORTS = new Set(["1280x800", "1440x900"]);
const CHANNEL_MAXIMUM = 255;
const SOURCE_LIMIT = 16_384;
const MAX_SCANNED_SOURCES = 8;
const MAX_DOM_NODES = 512;
const SENSITIVE_PATTERNS = [
  /\b(?:authorization|bearer)\s+[a-z0-9._~-]{12,}/iu,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[\w.-]{8,}/iu,
  /\b(?:sk|rk|ak)_[a-z0-9_-]{12,}/iu,
  /(?:rawPrompt|shepherdPrompt|promptVersion|sessionToken|worktreePath|workspacePath|repositoryPath|executionIdentity|runtimeSessionFingerprint)/iu,
  /(?:[a-z]:\\users\\|\/(?:private|home)\/|\\\\[^\\]+\\[^\\]+)/iu,
  /(?:e2e\d*[-_])?(?:private|seeded|secret)[-_ ]?(?:canary|marker|diagnostic)/iu,
];

function parseColor(color) {
  const value = String(color).trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value);
  if (hex) {
    const digits = hex[1].length === 3
      ? [...hex[1]].map((digit) => digit + digit).join("")
      : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
      1,
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/iu.exec(value);
  if (!rgb) throw new Error(`Unsupported CSS color: ${value}`);
  const channels = rgb.slice(1, 4).map(Number);
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
  if (
    channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > CHANNEL_MAXIMUM)
    || !Number.isFinite(alpha) || alpha < 0 || alpha > 1
  ) {
    throw new Error(`Unsupported CSS color: ${value}`);
  }
  return [...channels, alpha];
}

function relativeLuminance([red, green, blue]) {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / CHANNEL_MAXIMUM;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function composite(foreground, background) {
  const alpha = foreground[3];
  return [
    (foreground[0] * alpha) + (background[0] * (1 - alpha)),
    (foreground[1] * alpha) + (background[1] * (1 - alpha)),
    (foreground[2] * alpha) + (background[2] * (1 - alpha)),
    1,
  ];
}

function readableColor([red, green, blue, alpha]) {
  return alpha === 1
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function locatorLabel(locator) {
  return locator.toString?.() ?? "target locator";
}

function boundedText(value, limit = SOURCE_LIMIT) {
  let text = "";
  const seen = new Set();
  const append = (part) => {
    if (text.length < limit) text += String(part).slice(0, limit - text.length);
  };
  const serialize = (current, depth = 0) => {
    if (text.length >= limit || depth > 4) return;
    if (current === null || typeof current !== "object") {
      append(current);
      return;
    }
    if (seen.has(current)) {
      append("[Circular]");
      return;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      append("[");
      for (const item of current.slice(0, MAX_SCANNED_SOURCES)) {
        serialize(item, depth + 1);
        append(",");
      }
      append("]");
      return;
    }
    append("{");
    let inspectedCount = 0;
    for (const key in current) {
      if (inspectedCount >= MAX_SCANNED_SOURCES) break;
      inspectedCount += 1;
      if (!Object.hasOwn(current, key)) continue;
      append(`${key}:`);
      serialize(current[key], depth + 1);
      append(",");
    }
    append("}");
  };
  serialize(value);
  return text;
}

function boundedSources(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).slice(0, MAX_SCANNED_SOURCES);
}

export function contrastRatio(foreground, background) {
  const first = relativeLuminance(parseColor(foreground));
  const second = relativeLuminance(parseColor(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function normalizeEvidenceStage(stage) {
  const normalized = String(stage)
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized) throw new Error("Evidence stage must include letters or numbers");
  return normalized;
}

export function uiGateEvidencePath(viewportName, stage) {
  if (!VIEWPORTS.has(viewportName)) throw new Error(`Unsupported UI gate viewport: ${viewportName}`);
  return path.join(
    repositoryRoot,
    ".tmp",
    "playwright-evidence",
    "ui-gate",
    viewportName,
    `${normalizeEvidenceStage(stage)}.png`,
  );
}

export async function assertNoDocumentOverflow(page) {
  const geometry = await page.evaluate(() => ({
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    },
    body: {
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.body.clientHeight,
    },
  }));
  const overflowing = [];
  for (const [name, box] of Object.entries(geometry)) {
    if (box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1) {
      overflowing.push(`${name} ${box.scrollWidth}x${box.scrollHeight} exceeds ${box.clientWidth}x${box.clientHeight}`);
    }
  }
  if (overflowing.length > 0) {
    throw new Error(`Document overflow is not owned by a named internal pane: ${overflowing.join("; ")}`);
  }
}

export async function assertScrollOwner(locator) {
  const result = await locator.evaluate((element) => {
    const before = {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    };
    const style = getComputedStyle(element);
    const previous = { left: element.scrollLeft, top: element.scrollTop };
    const horizontal = {
      overflows: element.scrollWidth > element.clientWidth + 1,
      allowsScroll: style.overflowX === "auto" || style.overflowX === "scroll",
    };
    const vertical = {
      overflows: element.scrollHeight > element.clientHeight + 1,
      allowsScroll: style.overflowY === "auto" || style.overflowY === "scroll",
    };
    if (horizontal.overflows) element.scrollLeft = Math.min(element.scrollWidth, previous.left + 1);
    if (vertical.overflows) element.scrollTop = Math.min(element.scrollHeight, previous.top + 1);
    const after = {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    };
    horizontal.moved = element.scrollLeft !== previous.left;
    vertical.moved = element.scrollTop !== previous.top;
    element.scrollLeft = previous.left;
    element.scrollTop = previous.top;
    return { horizontal, vertical, before, after };
  });
  for (const [axis, status] of Object.entries({ horizontal: result.horizontal, vertical: result.vertical })) {
    if (status.overflows && (!status.allowsScroll || !status.moved)) {
      throw new Error(`${locatorLabel(locator)} has ${axis} overflowing content but is not a scrollable owner`);
    }
  }
  if (result.before.documentWidth !== result.after.documentWidth || result.before.bodyWidth !== result.after.bodyWidth) {
    throw new Error(`${locatorLabel(locator)} changed document width while scrolling`);
  }
}

export async function assertMinimumContrast(locator, minimum) {
  const observed = await locator.evaluate((element) => {
    const backgrounds = [];
    for (let current = element; current; current = current.parentElement) {
      const color = getComputedStyle(current).backgroundColor;
      if (color && color !== "transparent") backgrounds.push(color);
    }
    return {
      foreground: getComputedStyle(element).color,
      backgrounds,
      selector: element.id ? `#${element.id}` : element.getAttribute("aria-label") ?? element.tagName.toLowerCase(),
    };
  });
  let background = [255, 255, 255, 1];
  for (const color of observed.backgrounds.reverse()) background = composite(parseColor(color), background);
  const foreground = composite(parseColor(observed.foreground), background);
  const ratio = contrastRatio(readableColor(foreground), readableColor(background));
  if (ratio < minimum) {
    throw new Error(
      `Contrast for ${observed.selector} is ${ratio.toFixed(2)}:1; expected at least ${minimum}:1 `
      + `(foreground ${observed.foreground}, background ${readableColor(background)})`,
    );
  }
}

export async function assertVisibleFocus(page, locator) {
  await locator.focus();
  const result = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const colorIsVisible = (color) => {
      if (!color || color === "transparent") return false;
      const colors = color.match(/rgba?\([^)]*\)/gu);
      if (!colors) return true;
      return colors.some((candidate) => {
        const values = candidate.match(/[\d.]+/gu)?.map(Number) ?? [];
        return candidate.startsWith("rgb(") || (values[3] ?? 1) > 0;
      });
    };
    const accessibleName = element.getAttribute("aria-label")
      || (element.getAttribute("aria-labelledby")
        ? element.getAttribute("aria-labelledby").split(/\s+/u).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ")
        : "")
      || ("labels" in element ? [...element.labels ?? []].map((label) => label.textContent?.trim()).filter(Boolean).join(" ") : "")
      || element.getAttribute("title")
      || element.textContent?.trim();
    return {
      active: document.activeElement === element,
      accessibleName,
      visibleIndicator: (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0 && colorIsVisible(style.outlineColor))
        || (style.boxShadow !== "none" && colorIsVisible(style.boxShadow)),
    };
  });
  if (!result.active) throw new Error(`${locatorLabel(locator)} did not receive focus`);
  if (!result.accessibleName) throw new Error(`${locatorLabel(locator)} has no accessible name`);
  if (!result.visibleIndicator) throw new Error(`${locatorLabel(locator)} has no visible focus indicator`);
}

export async function assertSafeUiGateSurface(locator) {
  const unsafe = await locator.evaluate((root) => {
    const executable = root.matches("script, iframe, object, embed")
      ? root
      : root.querySelector("script, iframe, object, embed");
    if (executable) return { type: "executable descendant", detail: executable.tagName.toLowerCase() };
    const eventTarget = [root, ...root.querySelectorAll("*")].find((element) =>
      element.getAttributeNames().some((name) => /^on/iu.test(name)),
    );
    if (eventTarget) return { type: "inline event attribute", detail: eventTarget.tagName.toLowerCase() };
    return undefined;
  });
  if (unsafe) throw new Error(`${locatorLabel(locator)} contains ${unsafe.type} (${unsafe.detail})`);
}

export async function assertNoSensitiveCanaries({ page, responses = [], logs = [] }) {
  const dom = await page.locator("body").evaluate((body, { limit, maxNodes }) => {
    let text = "";
    const append = (part) => {
      if (text.length < limit) text += String(part).slice(0, limit - text.length);
    };
    const textWalker = body.ownerDocument.createTreeWalker(body, 4);
    for (let node = textWalker.nextNode(), count = 0; node && count < maxNodes; node = textWalker.nextNode(), count += 1) {
      append(node.nodeValue ?? "");
    }
    const elementWalker = body.ownerDocument.createTreeWalker(body, 1);
    for (let element = body, count = 0; element && count < maxNodes; element = elementWalker.nextNode(), count += 1) {
      for (const name of element.getAttributeNames()) append(`${name}=${element.getAttribute(name) ?? ""}\n`);
    }
    return text;
  }, { limit: SOURCE_LIMIT, maxNodes: MAX_DOM_NODES });
  const sources = [["public DOM", dom]];
  for (const [index, log] of boundedSources(logs).entries()) {
    sources.push([`browser/server log ${index + 1}`, log]);
  }
  for (const [index, response] of boundedSources(responses).entries()) {
    sources.push([`captured API response ${index + 1}`, response]);
  }
  for (const [source, value] of sources) {
    const text = boundedText(value);
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new Error(`Sensitive UI gate data was exposed in ${source}`);
    }
  }
}

export async function captureUiGate(page, viewportName, stage) {
  const screenshotPath = uiGateEvidencePath(viewportName, stage);
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}
