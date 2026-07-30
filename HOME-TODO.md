# When you're home (in order of impact, ~15 min total)

1. **Permanent URL** (biggest unlock — most directories reject our temporary tunnel):
   EITHER make a free account at render.com (sign in with GitHub, I'll deploy the service there)
   OR make a free cloudflare.com account (+ tell me; a ~$10/yr domain makes it bulletproof).
   Then just tell Claude which one you made.

2. **Redo the Coinbase API key** (unlocks the Bazaar index where agent buyers search):
   portal.cdp.coinbase.com → API keys → Create → **Secret API key**.
   The **ID** is the UUID-with-dashes → `CDP_API_KEY_ID` in `~/agent-hustle/.env`
   The **Secret** is the LONG ~88-char base64 string → `CDP_API_KEY_SECRET`
   Use the copy button, one line, no quotes. (Your first attempt saved the ID in both slots.)

3. **Fund the agent wallet** (unlocks claiming paid bounties on ClawTasks):
   Send on the **Base network** to `0x161D9DFe071D024637f7cA8DB3D5FB0CE27833E1`:
   ~$10 USDC + ~$2 ETH. Double-check network = Base, not Ethereum.

4. **Submit the service to x402-list.com/submit** (needs an email, so it's yours to do):
   service_name: `img-categorize` · service_url: current tunnel URL + `/categorize`
   (run `npm run status` in ~/agent-hustle to get the current URL) · your email · category: closest to AI/tools.

Then tell Claude "done with 1/2/3/4" and it wires everything up.
