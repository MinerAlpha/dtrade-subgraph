import {
  PositionAdjusted as PositionAdjustedEvent,
  PositionSettled as PositionSettledEvent,
  PositionChanged as PositionChangedEvent,
  PositionLiquidated as PositionLiquidatedEvent
} from '../generated/ClearingHouse/ClearingHouse';
import { dUSD32, dUSD4 } from './common';
import { PositionAdjusted, PositionSettled, PositionChanged, PositionLiquidated } from '../generated/schema';
import { store, BigInt, Address, ethereum, Bytes } from '@graphprotocol/graph-ts';
import { strToBytes } from './common';
import { log } from '@graphprotocol/graph-ts';

export function handlePositionAdjusted(event: PositionAdjustedEvent): void {
  let entity = new PositionAdjusted(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.trader = event.params.trader;
  entity.amm = event.params.amm;
  entity.newPositionSize = event.params.newPositionSize;
  entity.oldLiquidityIndex = event.params.oldLiquidityIndex;
  entity.newLiquidityIndex = event.params.newLiquidityIndex;
  entity.timestamp = event.block.timestamp;
  entity.save();

  log.debug('Finished handlePositionAdjusted', []);
}

export function handlePositionSettled(event: PositionSettledEvent): void {
  let entity = new PositionSettled(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.trader = event.params.trader;
  entity.amm = event.params.amm;
  entity.valueTransferred = event.params.valueTransferred;
  entity.timestamp = event.block.timestamp;
  entity.save();

  log.debug('Finished handlePositionSettled', []);
}

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

export function handlePositionLiquidated(event: PositionLiquidatedEvent): void {
  let entity = new PositionLiquidated(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.trader = event.params.trader;
  entity.amm = event.params.amm;
  entity.positionNotional = event.params.positionNotional;
  entity.positionSize = event.params.positionSize;
  entity.liquidationFee = event.params.liquidationFee;
  entity.liquidator = event.params.liquidator;
  entity.timestamp = event.block.timestamp;
  entity.save();

  log.debug('Finished handlePositionLiquidated', []);
}
