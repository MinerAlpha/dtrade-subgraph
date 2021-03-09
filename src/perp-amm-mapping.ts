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
    log.debug('****1****', []);
    let newAvgPosition = new AveragePosition(entity.trader.toHex() + '-' + entity.amm.toHex());

    newAvgPosition.lastPositionSize = entity.exchangedPositionSize;

    // avgLeverage = positionNotional/margin
    log.debug('****2****', []);
    log.debug(
      '****2.25**** posNot: ' + entity.positionNotional.toString() + ' | margin:' + entity.margin.toString(),
      []
    );
    log.debug('***2.5***' + entity.positionNotional.div(entity.margin).toString(), []);

    newAvgPosition.avgLeverage = entity.positionNotional.div(entity.margin.minus(oldAvgPosition.totalMargin));

    // if (newAvgPosition.avgLeverage < BigDecimal.fromString('0')) {
    //   log.debug('SHORT: making new.avgLvg +ve', []);
    //   newAvgPosition.avgLeverage = BigDecimal.fromString('-1').times(newAvgPosition.avgLeverage);
    //   log.debug('Made new.avgLvg +ve', []);
    // }
    // .times(BigInt.fromI32(1e18 as i32));

    // new.lastPrice = 1/(exchangedPositionSize/positionNotional)
    log.debug('****3****', []);
    newAvgPosition.lastPrice = BigDecimal.fromString('1').div(
      entity.exchangedPositionSize.div(entity.positionNotional)
    );

    newAvgPosition.notional = oldAvgPosition.notional.plus(entity.positionNotional);

    // size = exchangedPositionSize
    log.debug('****4****', []);
    newAvgPosition.size = entity.exchangedPositionSize;

    // totalMargin = margin
    log.debug('****5****', []);
    newAvgPosition.totalMargin = entity.margin;

    // ===final formulae===:

    log.debug('****6****', []);
    // avgLeverage =  ((old size * old avg leverage)  + (new size * positionNotional/(margin - old_margin))) / (old size + new size)
    // newAvgPosition.avgLeverage = oldAvgPosition.size
    //   .times(oldAvgPosition.avgLeverage)
    //   .plus(newAvgPosition.size.times(newAvgPosition.avgLeverage));

    // log.debug('part1 b4 div: ' + newAvgPosition.avgLeverage.toString(), []);
    // newAvgPosition.avgLeverage = newAvgPosition.avgLeverage.div(oldAvgPosition.size.plus(newAvgPosition.size));
    // log.debug('part2: aftr div' + newAvgPosition.avgLeverage.toString(), []);

    newAvgPosition.avgLeverage = newAvgPosition.notional.div(entity.margin);

    log.debug('****7****: ', []);
    // avgEntryPrice = ((old size * old avg entry price)  + (new size * exchangedPositionSize/positionNotional)) / (old size + new size)

    newAvgPosition.avgEntryPrice = oldAvgPosition.size
      .times(oldAvgPosition.avgEntryPrice)
      .plus(newAvgPosition.size.times(newAvgPosition.lastPrice))
      .div(oldAvgPosition.size.plus(newAvgPosition.size));

    log.debug('****8****: emit.exgPosSize:', []);

    // size = old size + exchangedPositionSize
    // newAvgPosition.size = oldAvgPosition.size.plus(entity.exchangedPositionSize);
    newAvgPosition.size = entity.positionSizeAfter;

    log.debug('****9****', []);

    // totalMargin = new margin
    newAvgPosition.totalMargin = entity.margin;

    log.debug('****10****', []);

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
