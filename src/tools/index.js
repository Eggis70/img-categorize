// Tool registry. Every deterministic tool lives in one of these modules and is
// wired up automatically: HTTP route, paywall price, OpenAPI path, discovery
// docs, MCP tool and directory listing all derive from this catalogue.
import { tools as textTools } from "./text.js";
import { tools as dataTools } from "./data.js";
import { tools as webTools } from "./web.js";
import { tools as convertTools } from "./convert.js";
import { tools as mediaTools } from "./media.js";
import { tools as chainTools } from "./chain.js";

const groups = {
  text: textTools,
  data: dataTools,
  web: webTools,
  convert: convertTools,
  media: mediaTools,
  chain: chainTools,
};

export const UTIL_TOOLS = {};
for (const [group, tools] of Object.entries(groups)) {
  for (const [name, def] of Object.entries(tools)) {
    if (UTIL_TOOLS[name]) throw new Error(`duplicate tool name: ${name}`);
    UTIL_TOOLS[name] = { ...def, group };
  }
}

export const UTIL_RUNNERS = Object.fromEntries(
  Object.entries(UTIL_TOOLS).map(([name, def]) => [name, def.run]),
);

/** Catalogue entries in the shape the rest of the app expects. */
export const UTIL_META = Object.fromEntries(
  Object.entries(UTIL_TOOLS).map(([name, def]) => [
    name,
    {
      kind: "util",
      group: def.group,
      price: `$${def.price}`,
      priceUsd: def.price,
      description: def.description,
      output: def.output,
      example: def.example,
    },
  ]),
);
