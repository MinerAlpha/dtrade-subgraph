// The latest Dtrade and event invocations
import { PositionChanged as PositionChangedEvent } from '../generated/ClearingHouse/ClearingHouse';

import { dUSD32, dUSD4 } from './common';

import { PositionChanged } from '../generated/schema';

import { store, BigInt, Address, ethereum, Bytes } from '@graphprotocol/graph-ts';

import { strToBytes } from './common';

import { log } from '@graphprotocol/graph-ts';

export function handlePositionChanged(event: PositionChangedEvent): void {
  let entity = new PositionChanged(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.trader = event.params.trader;
  entity.amm = event.params.amm;
  entity.margin = event.params.margin;
  entity.positionNotional = event.params.positionNotional;
  entity.exchangedPositionSize = event.params.exchangedPositionSize;
  entity.fee = event.params.fee;
  entity.positionSizeAfter = event.params.positionSizeAfter;
  entity.realizedPnl = event.params.realizedPnl;
  entity.unrealizedPnlAfter = event.params.unrealizedPnlAfter;
  entity.badDebt = event.params.badDebt;
  entity.liquidationPenalty = event.params.liquidationPenalty;
  entity.spotPrice = event.params.spotPrice;
  entity.fundingPayment = event.params.fundingPayment;
  entity.timestamp = event.block.timestamp;
  entity.save();

  log.debug('Finished handlePositionChanged', []);
}
