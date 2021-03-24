# dtrade-subgraph
This repo houses the dTrade subgraphs on The Graph


Subgraphs availabe: 
- dtrade (dtrade Stakr)
- rates (exchange rates for Stakr)
- perp-amm (Perpetuals on AMM)
- perp (Perpetuals on Orderbook)

# How to use

Run `npm run codegen:[subgraph]` to generate the TS types.

Run the npm run build:[subgraph] task for the subgraph.

Deploy via npm run deploy:[subgraph]. Note: requires env variable of $THEGRAPH_ACCESS_TOKEN set in bash to work.
