# Sticker Yard dapp

This is the active frontend source for the six-fighter arena. It consumes same-origin JSON APIs and a connected EIP-1193 wallet. No sample balances, generated client results or pretend payment receipts are used.

Public testnet: [the-pit-testnet.k2riddim.workers.dev](https://the-pit-testnet.k2riddim.workers.dev), Robinhood Chain Testnet (46630). This is not a production or real-money release. The UI discloses fixed test prices and house-paid test inference; test coins are not cash-value prizes.

## Required asset routes

- `/assets/yard.png`, `/assets/street.png`, `/assets/props-v2.png`, `/assets/catalog-A.png` through `/assets/catalog-G.png`.
- `/arena/{core,avatars,readability,content,policy}.mjs` and their relative dependencies.
- `/sock/sock.js` and its relative generated asset module.
- `/fonts/{GochiHand-Regular,Nunito-Black,JetBrainsMono-Bold}.ttf.bin`.
- Avatar image URLs must be same-origin images from the qualified artwork service. A validated sock key is composed without redrawing its source art.
- `/avatar-image.mjs` and `/avatar-unavailable.svg` provide a code-owned neutral sticker and **Picture unavailable** label when a raster cannot be displayed. Recursive HTML/SVG NFT documents are not executed; unsupported artwork never changes verified ownership, affiliation or the selected identity, and does not abort an arena replay.

## API contract

All integer money amounts are base-10 strings in wei, never JavaScript floating-point amounts. User write routes require the authenticated game-wallet session. Frontend hides admin controls without server permission; the backend must independently enforce every write.

`GET /api/config` (illustrative disabled/unavailable shape; the public response supplies its deployed addresses):

```json
{
  "chain": {"id":46630,"name":"Robinhood Chain Testnet","rpcUrl":"https://...","explorerUrl":"https://...","nativeCurrency":{"name":"Ether","symbol":"ETH","decimals":18}},
  "contracts": {"pit":null,"arena":null,"socks":null,"sale":null,"jackpot":null},
  "features": {"arena":false,"socks":false,"sale":false,"bitcoinOwnership":false,"faucet":false},
  "jackpot": {"amountWei":null,"message":"Temporarily unavailable."},
  "inference": {"configured":false,"models":[],"testOnly":true}
}
```

`POST /api/auth/challenge {address}` returns `{message,nonce}`. `POST /api/auth/verify {address,message,signature,nonce}` sets a secure HttpOnly session cookie.

`GET /api/me` returns `{address,profile,avatars,balances:{pitWei,ethWei,claimableWei},admin}`. The connected wallet address must match the authenticated address. Optional `fighters` supports several saved fighters. Profiles expose `{id,name,note,avatarId,avatar:{id,name,image?,key?},policyId}`. Avatars are server-qualified owned or free game faces, never a client ownership assertion.

`POST /api/fighter {name,note,avatarId}` saves the profile. `POST /api/fighter/compile {note,modelId,maxCostWei}` returns a transaction quote, a completed server-recorded brain receipt, or `{pending:true,jobId,status:'queued'|'running',message}`. Save changed notes before compiling. `inference.testOnly:true` hides the spending field and explicitly identifies house-paid test answers. Blank notes use free random policies. Both the frontend and service reject written but uncompiled notes at room admission. Unsaved changes cannot silently enter a room as the preceding fighter.

Queued preparations resume through `GET /api/fighter/compile/:jobId`, authenticated to the job owner. `/api/me` and `/api/fighter` may include a `preparation` summary with the same job ID and status. The frontend checks the existing job every five seconds for at most 60 checks, pauses on network failure, and offers **Check saved answer** to resume. It never creates a second compilation automatically. Completed jobs return the saved receipt; `{pending:false,status:'failed',message}` permits an explicit retry or a saved blank note. Polling does not clear newer unsaved edits.

The public test deployment uses an outbound authenticated relay to the private NAS LLPicker, model alias `kimi`, using Anthropic Messages. The NAS is not exposed to browsers. A shared server-side limit admits 100 new jobs per UTC day, at most eight queued/running jobs and one running inference. An offline relay can leave a written note pending; free blank-note behavior does not require it. The relay's atomic journal and exclusive lock preserve same-job delivery across restarts, with manual reconciliation for stale locks or damaged state. See the service README for the operator procedure, not a frontend retry loop.

`GET /api/rooms` returns `{rooms:Room[]}`. `GET /api/rooms/:id` returns a Room or `{room:Room}`. `POST /api/rooms {tierUsd,fighterId,policyId}` creates a room and returns a quote. `POST /api/rooms/:id/join {fighterId,policyId}` quotes a place in that room.

Room fields:

```text
id, tierUsd, stakeWei,
status: waiting | running | settling | settled | refunded,
players: [{id:0..5,name,address?,bot?,avatar:{image? | key?},note}],
message?, canRefund?: boolean, replay?: the persisted core.simulate output,
payouts?: [{id,pickupWei,podiumWei,jackpotWei,totalWei}]
```

The app plays the supplied replay as-is. It does not import or call `simulate`, choose a winner, or infer PIT payments from the number of pickups. Missing payment records display `Pending`; result and paid status remain separate. A room replay must contain all six ordered seats and complete ranking. A top-level or payout-row `jackpotPending:true` keeps jackpot/full totals pending. Confirmed payout amounts are displayed to all 18 decimals without rounding through Number. Settlement and jackpot completion refresh the wallet's collectable balance.

Wallet quote:

```text
{ quoteId, kind?, roomId?, room?, stakeWei?, costWei?, ethWei?, pitWei?, expiresAt?, message?,
  approval?: {chainId,to,data,value},
  transaction: {chainId,to,data,value} }
```

Alternatively return `transactions: [...]` in exact order. Approvals must cover the exact required amount. The UI checks network and configured contract destinations, asks the wallet for each transaction and waits for a successful receipt before continuing. It then submits `POST /api/transactions {hash,quoteId,roomId,kind}`. The service must verify transaction contents, sender, receipt, contract events and replay protection; a submitted hash is not proof of payment. A timeout is pending, never permission to replace or blindly resend an action.

Additional views:

- `GET /api/socks`: `{minted,maxSupply,mintedBy,cap,owned:[{tokenId,key?,image?}],example?:{key},message}`. `POST /api/socks/quote` returns a wallet quote. Final fulfillment is automatic; frontend neither chooses rarity nor requests a second mint signature.
- `GET /api/ladder`: `{players:[{name,iq,games,wins,earnedWei}]}`.
- `GET /api/launch`: `{raisedWei,deadline,purchasedPitWei,contributionWei,status,message,canBuy,canCollect,canRefund,canWithdrawExcess,canGraduate,excessWei,pair,lpLock,unlockAt}`. Status is `pending`, `active`, `graduated` or `failed`; timestamps are Unix seconds. Buy/claim/refund buttons require both the appropriate lifecycle state and an explicit server capability. POST `/api/launch/quote {ethWei}`, `/api/launch/collect`, `/api/launch/refund`, `/api/launch/excess`, `/api/launch/graduate` return wallet quotes. Unaccepted-ETH recovery is distinct from failed-sale refunds. Before graduation the UI does not invent a pool or LP unlock date.
- `POST /api/collect` returns a withdrawal transaction quote for already-earned game PIT.
- `GET /api/admin/collections` returns `{collections:[{id,name,kind:'bitcoin-inscriptions'|'erc721',contract?,chainId?,inscriptionIds?,enabled,version}]}`. POST of that shape creates or updates a versioned collection. Authentication alone is not authorization; the service must check founder/admin permission and canonical IDs.
- Bitcoin lists use `POST /api/admin/collections/import` with `{id,name,kind,enabled,inscriptionIds:upTo100,offset,total,importId?}`. The response returns `importId` until the final chunk. All chunks are staged; the server must atomically activate the complete validated version at the end, never expose an incomplete list as approved. The UI accepts `.json` and `.txt` files or a pasted list, validates canonical IDs and deduplicates before upload.
- `POST /api/rooms/:id/leave` and `/api/rooms/:id/refund` return wallet quotes. Leaving is shown only for a participant in a waiting room. Recovery is shown only when the server exposes `canRefund:true`; the contract remains authoritative for both conditions.
- `POST /api/faucet` returns a test-PIT faucet transaction quote. It is visible only when `features.faucet:true`, and its contract must appear as `contracts.faucet`.

The full list is limited to 20,000 inscriptions, including the actual 10,001 Bitcoin Puppets. Lists larger than one request are uploaded as bounded ordered chunks, never silently truncated.

## Testnet integration and production boundaries

Bitcoin ownership remains disabled unless the qualified service explicitly enables it; it is enabled in this public testnet. Xverse, UniSat and Leather message-signing adapters are present, alongside the offline message/signature flow for supported single-key addresses. A signature alone never grants collection ownership: the configured indexer must also establish current holdings against the approved canonical registry. The public registry includes Puppets, Honoraries, Opium and Lasogettes. Missing raster artwork, notably recursive HTML, uses the neutral fallback rather than granting or revoking affiliation. No Bitcoin wallet is required for the free sock.

Without configured contract addresses, paid actions stay disabled. The deployed testnet has public contract and inference acceptance records: see `../../deployments/testnet-public-acceptance.json`, `../../deployments/testnet-public-game-acceptance.json` and `../service/README.md`. The public Kimi relay was tested through authenticated saved-note preparation, cache reuse and reload recovery. Contract receipts and public funded-game acceptance are distinct from mocked unit tests or browser-only visual checks. They do not establish production readiness, a live market oracle, a permanent inference subsidy or holder authorization for NFTs used only as public artwork fixtures.

The public Worker now owns its signing operator. Use `npm run dev -- --check` from `engine` before local work; `npm run dev` refuses to start with an operator already assigned in the publication record. Use isolated contracts/operator/state or a deliberate reconciled handoff, never a second local nonce lane or a database reset. The inference-only outbound relay can run without starting the local signing Worker.

## Verification on September 10, 2026

- `node --test engine/app/client.node.test.mjs` covers launch lifecycle gates, queued-note recovery, saved-note admission gates, pending-jackpot totals, exact money parsing, same-origin artwork/API limits, neutral preview fallback, wallet sign-in, approval-before-entry, failed approval handling, destination/network checks, markup IDs, server-only replay, explicit Watch scroll and the full-size canonical collection import bound.
- `node --check` passed for the client modules. `git diff --check -- engine/app` passed.
- Before handoff, Chrome exercised the local service across Play, My fighter, Socks, The ladder, PIT launch, Rules and unauthorized Admin. Public browser verification uses the deployed URL above; do not restart the old local signing service to repeat this check.
- Desktop and 390 by 844 phone screenshots inspected. The phone document stayed within viewport width; horizontal scrolling was confined to the navigation/table components.
- The earlier unconfigured view checks verified disabled paid actions, no invented balances and no sample ladder players. Fixed test prices and house-paid test inference remain disclosed separately from target game rules.
- That initial browser pass did not exercise holder-owned Bitcoin proofs or wallet transactions. Public state/transaction acceptance was recorded separately afterward in the reports above; independent signed ownership fixtures are not a claim to control a public NFT holder. Do not confuse visual checks, signed fixtures and actual chain receipts.
