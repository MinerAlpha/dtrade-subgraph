import { LogTradeExtended as TradeEvent } from '../generated/PerpetualV1/PerpetualV1';
import { dUSD32, dUSD4 } from './common';
import { Trade, Average } from '../generated/schema';
import { store, BigInt, Address, ethereum, Bytes, BigDecimal } from '@graphprotocol/graph-ts';
import { strToBytes } from './common';
import { log } from '@graphprotocol/graph-ts';

export function handleLogTrade(event: TradeEvent): void {
  // event.params.extendedParams:
  // 0 marginAmount,
  // 1 positionAmount,
  // 2 makerAmountToDeposit,
  // 3 takerAmountToDeposit,
  // 4 makerLeverage,
  // 5 takerLeverage

  let _extendedParams = event.params.extendedParams;

  let entity = new Trade(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.maker = event.params.maker;
  entity.taker = event.params.taker;
  entity.trader = event.params.trader;
  entity.marginAmount = _extendedParams[0];
  entity.positionAmount = _extendedParams[1];
  entity.isBuy = event.params.isBuy;
  entity.makerBalance = event.params.makerBalance;
  entity.takerBalance = event.params.takerBalance;
  entity.timestamp = event.block.timestamp;
  entity.makerAmountToDeposit = BigDecimal.fromString(_extendedParams[2].toString());
  entity.takerAmountToDeposit = BigDecimal.fromString(_extendedParams[3].toString());
  entity.makerLeverage = BigDecimal.fromString(_extendedParams[4].toString());
  entity.takerLeverage = BigDecimal.fromString(_extendedParams[5].toString());
  entity.save();
  log.debug('Saved base entity', []);

  const makerAvg = calculateAverage(
    entity.maker,
    BigIntToBigDecimal(entity.marginAmount),
    BigIntToBigDecimal(entity.positionAmount),
    !entity.isBuy,
    entity.makerAmountToDeposit,
    entity.makerLeverage,
    event.block.timestamp
  );
  makerAvg.save();
  log.debug('Saved makerAvg', []);

  const takerAvg = calculateAverage(
    entity.taker,
    BigIntToBigDecimal(entity.marginAmount),
    BigIntToBigDecimal(entity.positionAmount),
    entity.isBuy,
    entity.takerAmountToDeposit,
    entity.takerLeverage,
    event.block.timestamp
  );
  takerAvg.save();
  log.debug('Saved takerAvg', []);

  log.debug('Finished handleLogTrade', []);
}

function calculateAverage(
  address: Bytes,
  marginAmount: BigDecimal,
  positionAmount: BigDecimal,
  isBuy: boolean,
  myDepositedAmount: BigDecimal,
  leverage: BigDecimal,
  timestamp: BigInt
): Average {
  let oldAvg = Average.load(address.toHex());
  const positionNotional = marginAmount;
  marginAmount = myDepositedAmount;

  if (oldAvg == null) {
    oldAvg = new Average(address.toString());
    oldAvg.avgEntryPrice = BigDecimal.fromString('0');
    oldAvg.avgLeverage = BigDecimal.fromString('0');
    oldAvg.totalMargin = BigDecimal.fromString('0');
    oldAvg.size = BigDecimal.fromString('0');
    oldAvg.lastPrice = BigDecimal.fromString('0');
    oldAvg.lastPositionSize = BigDecimal.fromString('0');
    oldAvg.notional = BigDecimal.fromString('0');
    oldAvg.totalDepositedAmount = BigDecimal.fromString('0');
    oldAvg.cumulativeSize = BigDecimal.fromString('0');
  }

  const newAvg = new Average(address.toHex());

  if (isBuy) {
    // subtract current margin from cumulative margin
    newAvg.totalMargin = oldAvg.totalMargin.minus(marginAmount);

    // add current position to cumulative postions
    newAvg.size = oldAvg.size.plus(positionAmount);
  } else {
    // add current margin from cumulative margin
    newAvg.totalMargin = oldAvg.totalMargin.plus(marginAmount);

    // subtract current position to cumulative postions
    newAvg.size = oldAvg.size.minus(positionAmount);
  }

  if (newAvg.size.equals(BigDecimal.fromString('0'))) {
    newAvg.avgEntryPrice = BigDecimal.fromString('0');
    newAvg.avgLeverage = BigDecimal.fromString('0');
    newAvg.totalMargin = BigDecimal.fromString('0');
    newAvg.size = BigDecimal.fromString('0');
    newAvg.lastPrice = BigDecimal.fromString('0');
    newAvg.lastPositionSize = BigDecimal.fromString('0');
    newAvg.notional = BigDecimal.fromString('0');
    newAvg.totalDepositedAmount = BigDecimal.fromString('0');
    newAvg.cumulativeSize = BigDecimal.fromString('0');
  } else {
    // newAvg.totalMargin = oldAvg.totalMargin.plus(marginAmount);
    newAvg.lastPositionSize = positionAmount;
    newAvg.lastPrice = positionNotional.div(positionAmount);
    newAvg.notional = oldAvg.notional.plus(positionNotional);
    newAvg.totalDepositedAmount = oldAvg.totalDepositedAmount.plus(myDepositedAmount);
    newAvg.avgLeverage = newAvg.notional.div(newAvg.totalDepositedAmount);

    newAvg.timestamp = timestamp;

    newAvg.cumulativeSize = oldAvg.cumulativeSize.plus(positionAmount);

    // Take absolute leverage
    newAvg.avgLeverage = absolute(newAvg.avgLeverage);

    // Take absolute - size could be negative
    newAvg.avgEntryPrice = absolute(
      absolute(oldAvg.cumulativeSize)
        .times(oldAvg.avgEntryPrice)
        .plus(positionAmount.times(newAvg.lastPrice))
        .div(absolute(newAvg.cumulativeSize))
    );
  }
  return newAvg;
}

function BigIntToBigDecimal(num: BigInt): BigDecimal {
  return BigDecimal.fromString(num.toString());
}

function absolute(num: BigDecimal): BigDecimal {
  return num.lt(BigDecimal.fromString('0')) ? num.neg() : num;
}
