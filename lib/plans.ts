import type { Protocol } from './radar.ts';

export const routes: Record<string, string> = {
  'Risk Curators': 'Managed vaults', 'Onchain Capital Allocator': 'Managed vaults', 'Yield Aggregator': 'Managed vaults',
  'Liquidity Manager': 'Liquidity', Dexs: 'Liquidity', Farm: 'Liquidity',
  Lending: 'Credit', 'Uncollateralized Lending': 'Credit', 'Collateral Markets': 'Credit',
  RWA: 'Real-world assets', CeDeFi: 'Custodied yield',
  Yield: 'Yield markets', 'Options Vault': 'Yield markets', 'Basis Trading': 'Hedged strategies',
  Derivatives: 'Trading', 'Interest Rate Derivatives': 'Trading', 'Prediction Market': 'Trading', 'Leveraged Farming': 'Trading',
  CDP: 'Stablecoins', 'CDP Manager': 'Stablecoins', 'Stablecoin Wrapper': 'Stablecoins', 'Dual-Token Stablecoin': 'Stablecoins',
  'Staking Pool': 'Delegation', Restaking: 'Delegation',
  Chain: 'Network activity', Payments: 'Payments', Insurance: 'Coverage',
  'Governance Incentives': 'Governance', 'OTC Marketplace': 'Research', Privacy: 'Research',
};

type Route = { time: string; budget: string; check: string; action: string; exit: string };
const recipes: Record<string, Route> = {
  'Managed vaults': {
    time: '20–35 min', budget: '$0 research · $10–25 optional principal + fees',
    check: 'Locate a vault where this curator is actually named. Record the vault address, deposit asset, cap, fee split and top underlying borrower or allocation.',
    action: 'Compare liquid reserves with the proposed withdrawal, then quote both directions. If deposits are open and redeemable, consider one deposit into that exact vault and save the share receipt.',
    exit: 'Read the vault’s withdrawal queue and who can change allocations. Check that the curator and the vault operator are credited separately before counting any points.',
  },
  Credit: {
    time: '20–30 min', budget: '$0 research · $10–25 optional supply + fees',
    check: 'Identify the exact lending market, supply cap, utilization, oracle and collateral list. For permissioned lending, stop if you cannot verify access and borrower terms.',
    action: 'Quote supply and withdrawal for the same asset. If liquidity can support an exit and terms are clear, consider a small supply-only position with no borrowing.',
    exit: 'Check whether available liquidity actually permits withdrawal. Revisit utilization and collateral exposure before deciding whether to leave capital in the market.',
  },
  Liquidity: {
    time: '25–40 min', budget: '$0 research · $15–30 optional LP principal + fees',
    check: 'Find a supported pool, verify both asset addresses and fee tier, then compare its current price and depth against a reference market.',
    action: 'Preview a swap and a return swap. If the pool explicitly credits LP activity and you accept inventory risk, preview a small two-sided position including the range and both exit assets.',
    exit: 'Record the pool and position identifier. Check whether a range can go inactive and compare the exit quote with simply holding both assets.',
  },
  'Real-world assets': {
    time: '30–45 min', budget: '$0 for diligence · minimums and redemption fees unverified',
    check: 'Find the issuer’s eligibility rules and the document that identifies the asset claim, trustee or custodian and governing jurisdiction.',
    action: 'Compare subscription minimum, dealing window and NAV timestamp against the redemption terms. Ask whether pending orders or only settled holdings would qualify for a published campaign.',
    exit: 'Keep this on research status until access, lockup and settlement are explicit. Save the next dealing or reporting date and check for a redemption gate.',
  },
  'Custodied yield': {
    time: '25–40 min', budget: '$0 research · fees and required deposit unverified',
    check: 'Identify who holds only the onchain wrapper and who holds the underlying exchange or custody balance. Check whether redemptions depend on either party.',
    action: 'Compare published NAV with the deposit and redemption quote. Review withdrawal suspension terms and segregation of client funds before considering funding.',
    exit: 'Keep a dated record of both quotes and any campaign terms. Stop if custody or proof of redemption cannot be established.',
  },
  'Yield markets': {
    time: '20–35 min', budget: '$0 research · $10–25 optional principal + fees',
    check: 'Identify the exact yield-bearing asset, how yield accrues, whether the position has a maturity and what happens to principal during a loss.',
    action: 'Compare holding the underlying against the yield position after fees and slippage. Preview a small deposit only where the strategy and path to redeem are both visible.',
    exit: 'Record the redemption deadline or cooldown and check attribution for the actual asset or market used.',
  },
  'Hedged strategies': {
    time: '25–40 min', budget: '$0 research · underlying minimum and fees unverified',
    check: 'Find the strategy factsheet and identify the spot asset, hedge venue, collateral and how changes in funding flow through to investors.',
    action: 'Compare ordinary and stressed exit terms. Observe funding and NAV through one reporting cycle before considering any deposit, and avoid opening your own leveraged hedge just to qualify.',
    exit: 'Write down the unwind delay, fee and funding assumptions. Recheck if funding changes sign or redemptions queue.',
  },
  Trading: {
    time: '20–35 min', budget: '$0 using a simulator or quote preview',
    check: 'Locate the market rules and identify margin, liquidation mechanics or event settlement rules as applicable. Check the actual instrument against any eligibility terms.',
    action: 'Use a simulator if offered or record an order preview and its round-trip spread. Keep activity in observation while eligibility is unverified.',
    exit: 'Save the instrument, fees and settlement source. Avoid adding leverage or repeated volume to pursue hypothetical rewards.',
  },
  Stablecoins: {
    time: '20–35 min', budget: '$0 research · $10–20 optional principal + fees',
    check: 'Confirm issuer, collateral or backing, peg mechanism and redemption asset. Check whether the available product is a wrapper, an issuer mint or a separate lending market.',
    action: 'Compare mint and redeem quotes with the secondary market. Prefer observing the spread first, and avoid opening a debt position for unverified points.',
    exit: 'Record the route back to the underlying, minimums and redemption fees. Revisit if the peg or redemption capacity moves materially.',
  },
  Delegation: {
    time: '20–30 min', budget: '$0 research · minimum stake and fees unverified',
    check: 'Identify the validator, operator or delegation pool and confirm which asset it accepts. Check minimum stake, slashing exposure and unbonding delay.',
    action: 'Preview delegation and withdrawal. Consider a small position only where the operator, lockup and relevant published activity requirements are clear.',
    exit: 'Record the exit epoch and pool or operator ID. Check whether redelegation or undelegation ends accrual before moving.',
  },
  'Network activity': {
    time: '15–30 min', budget: '$0 explorer or testnet · live fees unverified',
    check: 'Verify the network identifier, gas asset and official explorer. Check whether eligibility names mainnet, testnet or a specific application.',
    action: 'Read one explorer transaction end to end. If an official testnet is available, preview a basic transfer and inspect the resulting receipt or example.',
    exit: 'Save the network ID and observation date. Avoid bridging live funds solely because the network appears on the watchlist.',
  },
  Payments: {
    time: '20–30 min', budget: '$0 research · routing and channel costs unverified',
    check: 'Identify the settlement network, invoice expiry and routing costs. Distinguish custodial wallets from wallets that require channel liquidity.',
    action: 'Inspect an invoice or official test payment flow. Use a live payment only for a genuine purchase you intended to make and verify the total in the payment preview.',
    exit: 'Record the payment receipt privately and check whether there is an official program to track at all.',
  },
  Coverage: {
    time: '25–40 min', budget: '$0 quote · premium and capital minimum unverified',
    check: 'Identify the coverage provider, insured event, exclusions and claims process. Check whether a campaign addresses buyers or underwriting capital.',
    action: 'Request a quote or preview with a defined policy term. Compare premiums and coverage against the actual risk you would be paying to transfer.',
    exit: 'Save expiry and claim documentation. Avoid underwriting unfamiliar exposures solely for possible rewards.',
  },
  Governance: {
    time: '15–25 min', budget: '$0 research · any lockup and fees unverified',
    check: 'Find the official incentive schedule and identify the pool, eligible stake, epoch and whether a lock or vote is actually required.',
    action: 'Compare the disclosed incentive with lockup and withdrawal terms. Preview one eligible action if there is an active program with clear attribution.',
    exit: 'Save the epoch cutoff and check whether an early exit forfeits accrual. Skip activity if the incentive window has closed.',
  },
  Research: {
    time: '15–25 min', budget: '$0 research · no deposit assumed',
    check: 'Identify the actual product and whether the TVL belongs to a primary protocol, an integration, or a wrapper. Verify ownership of the application before connecting anything.',
    action: 'Inspect a read-only preview or documentation example. Record supported assets, eligibility requirements and the earliest reversible step.',
    exit: 'Recheck only when official terms name a qualifying action and show how to exit. Keep funds untouched when the route is unclear.',
  },
};

const focus: Record<string, string> = {
  'lightning-network': 'Review invoice expiry, inbound liquidity and channel-close fees before considering a noncustodial route.',
  'bittensor-dtao': 'Check which subnet the stake targets and compare the TAO-to-alpha quote with its reverse. Review concentration and unstaking liquidity for that subnet.',
  'reti-pooling': 'Identify the pool’s validator commission and eligible stake. Verify the payout and unstake rules of the specific pool before considering delegation.',
  'noble': 'Distinguish direct network activity from an application on another chain. Check the native asset denomination and route back before any transfer.',
  'lofty': 'Inspect one property’s ownership documents, distribution schedule and secondary-market exit conditions. Compare liquidity for that property to the position size.',
  'symbiotic': 'Identify the vault’s collateral, associated operator and opt-in networks. Review slashing and withdrawal delays for that exact configuration.',
  'firelight': 'Check the distinction between buying cover and supplying underwriting capital. Record who bears losses and when funds can be withdrawn.',
  'mezo-earn': 'Check the published earn rules for the asset and pool you would actually use. Verify whether a holding period applies before estimating any accrual.',
  'usdd': 'Check the protocol record against the issuer’s own asset documentation first. A protocol entry with blank token fields can still represent an existing stablecoin.',
};

export function farmPlan(p: Protocol) {
  const recipe = recipes[routes[p.category ?? ''] ?? 'Research'];
  const chain = p.chains.length ? p.chains.join(', ') : 'no chain reported';
  const steps = [
    `Start with ${p.name}’s official documentation. Snapshot networks: ${chain}. Confirm the exact supported market and any published campaign, eligible actions and cutoff date.`,
    recipe.check,
    ...(focus[p.slug] ? [focus[p.slug]] : []),
    recipe.action,
    recipe.exit,
  ];
  return { time: recipe.time, budget: recipe.budget, farm_steps: steps };
}
