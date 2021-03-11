import {
  PositionAdjusted as PositionAdjustedEvent,
  PositionSettled as PositionSettledEvent,
  PositionChanged as PositionChangedEvent,
  PositionLiquidated as PositionLiquidatedEvent
} from '../generated/ClearingHouse/ClearingHouse';
import { dUSD32, dUSD4 } from './common';
import {
  PositionAdjusted,
  PositionSettled,
  PositionChanged,
  PositionLiquidated,
  AveragePosition
} from '../generated/schema';
import { log, store, BigInt, Address, ethereum, Bytes, BigDecimal } from '@graphprotocol/graph-ts';
import { strToBytes } from './common';

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

function BigIntToBigDecimal(num: BigInt): BigDecimal {
  return BigDecimal.fromString(num.toString());
}

export function handlePositionChanged(event: PositionChangedEvent): void {
  log.debug('Before saving entity', []);
  let entity = new PositionChanged(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.trader = event.params.trader;
  entity.amm = event.params.amm;
  entity.margin = BigIntToBigDecimal(event.params.margin);
  entity.positionNotional = BigIntToBigDecimal(event.params.positionNotional);
  entity.exchangedPositionSize = BigIntToBigDecimal(event.params.exchangedPositionSize);
  entity.fee = BigIntToBigDecimal(event.params.fee);
  entity.positionSizeAfter = BigIntToBigDecimal(event.params.positionSizeAfter);
  entity.realizedPnl = BigIntToBigDecimal(event.params.realizedPnl);
  entity.unrealizedPnlAfter = BigIntToBigDecimal(event.params.unrealizedPnlAfter);
  entity.badDebt = BigIntToBigDecimal(event.params.badDebt);
  entity.liquidationPenalty = BigIntToBigDecimal(event.params.liquidationPenalty);
  entity.spotPrice = BigIntToBigDecimal(event.params.spotPrice);
  entity.fundingPayment = BigIntToBigDecimal(event.params.fundingPayment);
  entity.timestamp = event.block.timestamp;
  entity.save();
  log.debug('after saving entity', []);

  // TODO: Refactor this!

  // 1. Check if AveragePosition already exists for this trader and amm:
  let oldAvgPosition = AveragePosition.load(entity.trader.toHex() + '-' + entity.amm.toHex());

  // if entity.positionSizeAfter == 0 then avgPos = reset to 0
  if (entity.positionSizeAfter.equals(BigDecimal.fromString('0'))) {
    // If oldAvgPosition doesn't exists, create new
    if (oldAvgPosition == null) {
      oldAvgPosition = new AveragePosition(entity.trader.toHex() + '-' + entity.amm.toHex());
    }
    log.debug('setting to 0', []);
    oldAvgPosition.avgEntryPrice = BigDecimal.fromString('0');
    oldAvgPosition.avgLeverage = BigDecimal.fromString('0');
    oldAvgPosition.totalMargin = BigDecimal.fromString('0');
    oldAvgPosition.size = BigDecimal.fromString('0');
    oldAvgPosition.lastPrice = BigDecimal.fromString('0');
    oldAvgPosition.lastPositionSize = BigDecimal.fromString('0');
    oldAvgPosition.notional = BigDecimal.fromString('0');
    oldAvgPosition.save();
  } else {
    if (oldAvgPosition == null) {
      log.debug('oldAvgPos is null', []);
      // set default values to zero:
      oldAvgPosition = new AveragePosition(entity.trader.toHex() + '-' + entity.amm.toHex());
      oldAvgPosition.avgEntryPrice = BigDecimal.fromString('0');
      oldAvgPosition.avgLeverage = BigDecimal.fromString('0');
      oldAvgPosition.totalMargin = BigDecimal.fromString('0');
      oldAvgPosition.size = BigDecimal.fromString('0');
      oldAvgPosition.lastPrice = BigDecimal.fromString('0');
      oldAvgPosition.lastPositionSize = BigDecimal.fromString('0');
      oldAvgPosition.notional = BigDecimal.fromString('0');
    } else {
      log.debug('oldAvgPos found: id = ' + oldAvgPosition.get('id').toString(), []);
    }

    // for first entry:
    let newAvgPosition = new AveragePosition(entity.trader.toHex() + '-' + entity.amm.toHex());

    log.debug('****1****', []);
    newAvgPosition.lastPositionSize = entity.exchangedPositionSize;

    // new.lastPrice = 1/(exchangedPositionSize/positionNotional)
    log.debug('****2****', []);
    newAvgPosition.lastPrice = entity.positionNotional.div(entity.exchangedPositionSize);

    log.debug('****3****', []);
    newAvgPosition.notional = oldAvgPosition.notional.plus(entity.positionNotional);

    // size = exchangedPositionSize
    log.debug('****4****', []);
    newAvgPosition.size = entity.positionSizeAfter;

    // totalMargin = margin
    log.debug('****5****', []);
    newAvgPosition.totalMargin = entity.margin;

    // avgLeverage = positionNotional/margin
    log.debug('****6****', []);
    newAvgPosition.avgLeverage = newAvgPosition.notional.div(entity.margin);

    // avgEntryPrice = ((old size * old avg entry price)  + (new size * exchangedPositionSize/positionNotional)) / (cumulative size)
    log.debug('****7****: ', []);
    newAvgPosition.avgEntryPrice = oldAvgPosition.size
      .times(oldAvgPosition.avgEntryPrice)
      .plus(entity.exchangedPositionSize.times(newAvgPosition.lastPrice))
      .div(entity.positionSizeAfter);

    newAvgPosition.save();

    log.debug('Saved newAvgPos', []);
  }
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
