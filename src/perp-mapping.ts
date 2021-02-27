import { LogTrade as TradeEvent } from '../generated/PerpetualV1/PerpetualV1';
import { dUSD32, dUSD4 } from './common';
import { Trade } from '../generated/schema';
import { store, BigInt, Address, ethereum, Bytes } from '@graphprotocol/graph-ts';
import { strToBytes } from './common';
import { log } from '@graphprotocol/graph-ts';

export function handleLogTrade(event: TradeEvent): void {
  let entity = new Trade(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.maker = event.params.maker;
  entity.taker = event.params.taker;
  entity.trader = event.params.trader;
  entity.marginAmount = event.params.marginAmount;
  entity.positionAmount = event.params.positionAmount;
  entity.isBuy = event.params.isBuy;
  entity.makerBalance = event.params.makerBalance;
  entity.takerBalance = event.params.takerBalance;
  entity.timestamp = event.block.timestamp;
  entity.save();

  log.debug('Finished handleLogTrade', []);
}
