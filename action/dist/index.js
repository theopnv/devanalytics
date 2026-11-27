"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// action/src/index.ts
var import_node_process = __toESM(require("node:process"), 1);

// core/action/run.ts
var import_node_path = __toESM(require("node:path"), 1);

// core/contract.ts
var ValidationError = class extends Error {
  name = "ValidationError";
};

// core/action/inputs.ts
var InputError = class extends Error {
  name = "InputError";
};
function inputVariable(name) {
  return `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
}
function readInput(env, name) {
  return (env[inputVariable(name)] ?? "").trim();
}
function parseWorkerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new InputError(`worker-url "${value}" is not a URL. Set the DEVANALYTICS_URL variable to the address of the Worker.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InputError("worker-url must start with https://.");
  }
  return value.replace(/\/+$/, "");
}
function readCoreInputs(env) {
  const metric2 = readInput(env, "metric");
  if (!metric2) {
    throw new InputError("Set the metric input.");
  }
  const token = readInput(env, "token");
  if (!token) {
    throw new InputError("Set the DEVANALYTICS_INGEST_TOKEN secret to the Worker's INGEST_TOKEN, and pass it in the token input.");
  }
  const workerUrl = readInput(env, "worker-url");
  if (!workerUrl) {
    throw new InputError("Set the DEVANALYTICS_URL variable to the address of the Worker, and pass it in the worker-url input.");
  }
  return { metric: metric2, token, workerUrl: parseWorkerUrl(workerUrl), workingDirectory: readInput(env, "working-directory") || "." };
}
function readMetricInputs(specs, env) {
  const inputs = {};
  for (const { name, default: fallback } of specs) {
    const value = readInput(env, name) || fallback;
    if (value) {
      inputs[name] = value;
    }
  }
  return inputs;
}

// core/worker/budget.ts
var BACKFILL_HEADER = "X-Devanalytics-Mode";

// core/action/upload.ts
var RETRY_DELAYS = [1e3, 2e3, 4e3];
var REQUEST_TIMEOUT = 3e4;
var MAX_DETAIL = 300;
var UploadError = class extends Error {
  name = "UploadError";
  status;
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
var RateLimitError = class extends UploadError {
  name = "RateLimitError";
  retryAfter;
  constructor(message, retryAfter) {
    super(message, 429);
    this.retryAfter = retryAfter;
  }
};
var defaultSleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function field(value, name) {
  return typeof value === "object" && value !== null ? value[name] : void 0;
}
function errorDetail(body) {
  const message = field(parseJson(body), "error");
  return typeof message === "string" ? message : body.trim().slice(0, MAX_DETAIL);
}
function retryAfterSeconds(response) {
  const header = response.headers.get("Retry-After");
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds : void 0;
}
function rateLimitError(route, response, detail, now) {
  const seconds = retryAfterSeconds(response);
  const when = seconds === void 0 ? "Try again after 00:00 UTC." : `Try again in ${seconds} seconds, after ${new Date(now.getTime() + seconds * 1e3).toISOString()}.`;
  return new RateLimitError(`Ingest on ${route} was refused by the write budget: ${detail}. ${when}`, seconds);
}
function rowsWritten(body, route) {
  const written = field(parseJson(body), "rowsWritten");
  if (typeof written !== "number") {
    throw new UploadError(`Ingest on ${route} gave a response that is not valid: ${body.slice(0, MAX_DETAIL)}`);
  }
  return written;
}
async function upload(target, metric2, snapshot, options = {}) {
  const { fetch: send = fetch, sleep = defaultSleep, now = () => /* @__PURE__ */ new Date(), retryDelays = RETRY_DELAYS, timeout = REQUEST_TIMEOUT } = options;
  const route = `/v1/${metric2}/ingest`;
  const headers = { "Authorization": `Bearer ${target.token}`, "Content-Type": "application/json" };
  if (options.backfill) {
    headers[BACKFILL_HEADER] = "backfill";
  }
  const body = JSON.stringify(snapshot);
  let failure = "";
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelays[attempt - 1] ?? 0);
    }
    let response;
    try {
      response = await send(`${target.url}${route}`, { method: "POST", headers, body, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      failure = `the request failed: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    const text = await response.text();
    if (response.ok) {
      return { rowsWritten: rowsWritten(text, route) };
    }
    if (response.status === 429) {
      throw rateLimitError(route, response, errorDetail(text), now());
    }
    if (response.status < 500) {
      throw new UploadError(`Ingest on ${route} failed with ${response.status}: ${errorDetail(text)}`, response.status);
    }
    failure = `the Worker answered ${response.status}: ${errorDetail(text)}`;
  }
  throw new UploadError(`Ingest on ${route} failed after ${retryDelays.length + 1} attempts, because ${failure}`);
}

// core/action/run.ts
function describeKey(snapshot) {
  return "sha" in snapshot ? snapshot.sha : `run ${snapshot.run_id} attempt ${snapshot.run_attempt}`;
}
function findEntry(registry, name) {
  const entry = registry.find(({ metric: metric2 }) => metric2.name === name);
  if (!entry) {
    const names = registry.map(({ metric: metric2 }) => metric2.name).join(", ") || "none";
    throw new InputError(`Unknown metric "${name}". The metrics in this version are: ${names}.`);
  }
  return entry;
}
async function runAction(registry, env, deps) {
  const core = readCoreInputs(env);
  const { metric: metric2, collector: collector2 } = findEntry(registry, core.metric);
  const cwd = import_node_path.default.resolve(deps.cwd ?? process.cwd(), core.workingDirectory);
  const collected = await collector2.collect({ inputs: readMetricInputs(collector2.inputs, env), cwd, env });
  let snapshot;
  try {
    snapshot = metric2.parse(collected);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new Error(`The ${metric2.name} collector made a snapshot that is not valid: ${error.message}`, { cause: error });
    }
    throw error;
  }
  const { rowsWritten: rowsWritten2 } = await upload({ url: core.workerUrl, token: core.token }, metric2.name, snapshot, deps.uploadOptions);
  deps.log(`${metric2.name}: uploaded ${describeKey(snapshot)}, ${rowsWritten2} rows written.`);
}

// metrics/example/metric.ts
var MAX_ITEMS = 1e3;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseItem(value, index) {
  if (!isRecord(value)) {
    throw new ValidationError(`items[${index}] must be an object`);
  }
  const { name, value: amount } = value;
  if (typeof name !== "string" || name.length === 0) {
    throw new ValidationError(`items[${index}].name must be a non-empty string`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new ValidationError(`items[${index}].value must be an integer`);
  }
  return { name, value: amount };
}
var metric = {
  name: "example",
  key: "commit",
  parse(body) {
    if (!isRecord(body)) {
      throw new ValidationError("snapshot must be an object");
    }
    const { sha, date, items } = body;
    if (typeof sha !== "string" || !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
      throw new ValidationError("sha must be a 40 or 64 character hex string");
    }
    if (typeof date !== "string" || Number.isNaN(Date.parse(date))) {
      throw new ValidationError("date must be an ISO 8601 date");
    }
    if (!Array.isArray(items) || items.length > MAX_ITEMS) {
      throw new ValidationError(`items must be an array of at most ${MAX_ITEMS} items`);
    }
    return { sha, date, items: items.map(parseItem) };
  }
};

// metrics/example/collect.ts
var import_promises = require("node:fs/promises");
var import_node_path2 = __toESM(require("node:path"), 1);
var collector = {
  inputs: [{ name: "file", description: "JSON file with the sha, the date and the items.", default: "example.json" }],
  backfill: "commits",
  async collect(ctx) {
    const text = await (0, import_promises.readFile)(import_node_path2.default.resolve(ctx.cwd, ctx.inputs["file"] ?? "example.json"), "utf8");
    return metric.parse(JSON.parse(text));
  }
};

// action/src/generated/collector-registry.ts
var collectorRegistry = [
  { metric, collector }
];

// action/src/index.ts
var escapeCommand = (message) => message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
runAction(collectorRegistry, import_node_process.default.env, { log: (line) => import_node_process.default.stdout.write(`${line}
`) }).catch((error) => {
  import_node_process.default.stdout.write(`::error::${escapeCommand(error instanceof Error ? error.message : String(error))}
`);
  import_node_process.default.exitCode = 1;
});
