// Blockchain read tools. Public RPC only — no keys, no signing, read-only.
import { createPublicClient, http, formatEther, formatUnits, isAddress, getAddress, erc20Abi } from "viem";
import { base, mainnet } from "viem/chains";

const CHAINS = {
  base: { chain: base, rpc: "https://mainnet.base.org", explorer: "https://basescan.org" },
  ethereum: { chain: mainnet, rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io" },
};

const clients = {};
function clientFor(name) {
  const key = String(name ?? "base").toLowerCase();
  const cfg = CHAINS[key];
  if (!cfg) {
    throw Object.assign(new Error(`unsupported chain: ${name}. Use ${Object.keys(CHAINS).join(" or ")}`), { status: 400 });
  }
  clients[key] ??= createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
  return { client: clients[key], cfg, key };
}

function requireAddress(addr) {
  if (typeof addr !== "string" || !isAddress(addr)) {
    throw Object.assign(new Error("valid 0x address required"), { status: 400 });
  }
  return getAddress(addr);
}

export const tools = {
  wallet_balance: {
    price: 0.015,
    description:
      'Native and USDC balance for an address. POST {"address": "0x...", "chain": "base"|"ethereum"} -> balances, transaction count and explorer link.',
    output: { native: "string", usdc: "string" },
    example: { address: "0x161D9DFe071D024637f7cA8DB3D5FB0CE27833E1", chain: "base" },
    run: async ({ address, chain = "base" }) => {
      const addr = requireAddress(address);
      const { client, cfg, key } = clientFor(chain);
      const usdcAddress = key === "base"
        ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        : "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
      const [wei, txCount, usdc] = await Promise.all([
        client.getBalance({ address: addr }),
        client.getTransactionCount({ address: addr }),
        client.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [addr] }).catch(() => null),
      ]);
      return {
        address: addr,
        chain: key,
        native: formatEther(wei),
        nativeSymbol: cfg.chain.nativeCurrency.symbol,
        usdc: usdc == null ? null : formatUnits(usdc, 6),
        transactionCount: txCount,
        explorer: `${cfg.explorer}/address/${addr}`,
      };
    },
  },

  token_info: {
    price: 0.015,
    description:
      'ERC-20 token metadata. POST {"token": "0x...", "chain": "base"} -> name, symbol, decimals, total supply.',
    output: { name: "string", symbol: "string", decimals: 0 },
    example: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain: "base" },
    run: async ({ token, chain = "base" }) => {
      const addr = requireAddress(token);
      const { client, cfg, key } = clientFor(chain);
      const call = (functionName) =>
        client.readContract({ address: addr, abi: erc20Abi, functionName }).catch(() => null);
      const [name, symbol, decimals, supply] = await Promise.all([
        call("name"), call("symbol"), call("decimals"), call("totalSupply"),
      ]);
      if (name == null && symbol == null && decimals == null) {
        throw Object.assign(new Error("not an ERC-20 contract on this chain"), { status: 422 });
      }
      return {
        address: addr,
        chain: key,
        name,
        symbol,
        decimals,
        totalSupply: supply != null && decimals != null ? formatUnits(supply, decimals) : null,
        explorer: `${cfg.explorer}/token/${addr}`,
      };
    },
  },

  gas_price: {
    price: 0.01,
    description:
      'Current gas price and what a transfer costs. POST {"chain": "base"|"ethereum"} -> gwei, block number and estimated transfer cost.',
    output: { gwei: 0, blockNumber: 0 },
    example: { chain: "base" },
    run: async ({ chain = "base" }) => {
      const { client, cfg, key } = clientFor(chain);
      const [gas, block] = await Promise.all([client.getGasPrice(), client.getBlockNumber()]);
      const transferCost = gas * 21000n;
      return {
        chain: key,
        wei: gas.toString(),
        gwei: Number(formatUnits(gas, 9)),
        blockNumber: Number(block),
        estimatedTransferCost: `${formatEther(transferCost)} ${cfg.chain.nativeCurrency.symbol}`,
      };
    },
  },

  address_validate: {
    price: 0.005,
    description:
      'Validate an EVM address and detect whether it is a contract. POST {"address": "0x...", "chain": "base"} -> checksum form and account type.',
    output: { valid: true, isContract: false, checksum: "string" },
    example: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chain: "base" },
    run: async ({ address, chain = "base" }) => {
      if (typeof address !== "string" || !isAddress(address)) {
        return { valid: false, reason: "not a valid EVM address" };
      }
      const addr = getAddress(address);
      const { client, cfg, key } = clientFor(chain);
      const code = await client.getCode({ address: addr }).catch(() => null);
      const isContract = Boolean(code && code !== "0x");
      return {
        valid: true,
        checksum: addr,
        wasChecksummed: address === addr,
        isContract,
        type: isContract ? "contract" : "externally owned account",
        chain: key,
        explorer: `${cfg.explorer}/address/${addr}`,
      };
    },
  },

  ens_resolve: {
    price: 0.015,
    description:
      'Resolve an ENS name to an address, or an address to its primary ENS name. POST {"name": "vitalik.eth"} or {"address": "0x..."}.',
    output: { address: "string", name: "string" },
    example: { name: "vitalik.eth" },
    run: async ({ name, address }) => {
      const { client } = clientFor("ethereum");
      if (name) {
        if (typeof name !== "string" || !name.endsWith(".eth")) {
          throw Object.assign(new Error("name must be an .eth domain"), { status: 400 });
        }
        const resolved = await client.getEnsAddress({ name }).catch(() => null);
        return { name, address: resolved, resolved: Boolean(resolved) };
      }
      const addr = requireAddress(address);
      const ens = await client.getEnsName({ address: addr }).catch(() => null);
      return { address: addr, name: ens, resolved: Boolean(ens) };
    },
  },

  tx_lookup: {
    price: 0.02,
    description:
      'Look up a transaction by hash. POST {"hash": "0x...", "chain": "base"} -> status, value, gas used, from/to and block.',
    output: { status: "string", value: "string", from: "string", to: "string" },
    example: { hash: "0x7bf9ee0ddb1d36696f8711fcc06e04498dff41194a7eaab256a596508667ef38", chain: "base" },
    run: async ({ hash, chain = "base" }) => {
      if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) {
        throw Object.assign(new Error("valid 0x transaction hash required"), { status: 400 });
      }
      const { client, cfg, key } = clientFor(chain);
      const tx = await client.getTransaction({ hash }).catch(() => null);
      if (!tx) throw Object.assign(new Error("transaction not found on this chain"), { status: 404 });
      const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
      return {
        hash,
        chain: key,
        status: receipt ? (receipt.status === "success" ? "success" : "reverted") : "pending",
        from: tx.from,
        to: tx.to,
        value: `${formatEther(tx.value)} ${cfg.chain.nativeCurrency.symbol}`,
        blockNumber: tx.blockNumber != null ? Number(tx.blockNumber) : null,
        gasUsed: receipt ? Number(receipt.gasUsed) : null,
        feePaid: receipt ? `${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ${cfg.chain.nativeCurrency.symbol}` : null,
        explorer: `${cfg.explorer}/tx/${hash}`,
      };
    },
  },
};
