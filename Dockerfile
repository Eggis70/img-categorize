# Blixtworks MCP server (stdio). Buyers run this locally so their wallet key
# never leaves their machine; payment happens per call in USDC on Base.
#
#   docker build -t blixtworks-mcp .
#   docker run -i -e BLIXTWORKS_PRIVATE_KEY=0x... blixtworks-mcp
#
# Without a key it still starts and serves the free catalogue tool.
FROM node:22-alpine

WORKDIR /app

COPY mcp/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY mcp/server.js ./server.js
COPY mcp/README.md ./README.md

ENV NODE_ENV=production
ENTRYPOINT ["node", "server.js"]
