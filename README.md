# dtrade-subgraph
This repo houses the dTrade subgraphs on The Graph


Subgraphs availabe: 
- [dtrade (dtrade Stakr)](https://thegraph.com/explorer/subgraph/dtrade-team/dtrade) (deprecated)
- [rates (exchange rates for Stakr)](https://thegraph.com/explorer/subgraph/dtrade-team/dtraderates) (deprecated)
- [perp-amm (Perpetuals on AMM)](https://thegraph.com/explorer/subgraph/dtrade-team/perpetualamm)
- [perp (Perpetuals on Orderbook)](https://thegraph.com/explorer/subgraph/dtrade-team/perpetual)

# How to use

Run `npm run codegen:[subgraph]` to generate the TS types.

Run `npm run build:[subgraph]` task for the subgraph.

Deploy via `npm run deploy:[subgraph]`. 

Note: requires env variable of `$THEGRAPH_ACCESS_TOKEN` set in bash to work.
