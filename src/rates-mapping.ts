import { BigInt } from '@graphprotocol/graph-ts';
import { ExchangeRates, RatesUpdated as RatesUpdatedEvent } from '../generated/ExchangeRates/ExchangeRates';
import { RatesUpdated, RateUpdate, FifteenMinuteDETPrice, DailyDETPrice, LatestRate } from '../generated/schema';

function loadDailyDETPrice(id: string): DailyDETPrice {
  let newDailyDETPrice = new DailyDETPrice(id);
  newDailyDETPrice.count = BigInt.fromI32(0);
  newDailyDETPrice.averagePrice = BigInt.fromI32(0);
  return newDailyDETPrice;
}

function loadFifteenMinuteDETPrice(id: string): FifteenMinuteDETPrice {
  let newFifteenMinuteDETPrice = new FifteenMinuteDETPrice(id);
  newFifteenMinuteDETPrice.count = BigInt.fromI32(0);
  newFifteenMinuteDETPrice.averagePrice = BigInt.fromI32(0);
  return newFifteenMinuteDETPrice;
}

function calculateAveragePrice(oldAveragePrice: BigInt, newRate: BigInt, newCount: BigInt): BigInt {
  return oldAveragePrice
    .times(newCount.minus(BigInt.fromI32(1)))
    .plus(newRate)
    .div(newCount);
}

function handleDETPrices(timestamp: BigInt, rate: BigInt): void {
  let dayID = timestamp.toI32() / 86400;
  let fifteenMinuteID = timestamp.toI32() / 900;

  let dailyDETPrice = DailyDETPrice.load(dayID.toString());
  let fifteenMinuteDETPrice = FifteenMinuteDETPrice.load(fifteenMinuteID.toString());

  if (dailyDETPrice == null) {
    dailyDETPrice = loadDailyDETPrice(dayID.toString());
  }

  if (fifteenMinuteDETPrice == null) {
    fifteenMinuteDETPrice = loadFifteenMinuteDETPrice(fifteenMinuteID.toString());
  }

  dailyDETPrice.count = dailyDETPrice.count.plus(BigInt.fromI32(1));
  dailyDETPrice.averagePrice = calculateAveragePrice(dailyDETPrice.averagePrice, rate, dailyDETPrice.count);

  fifteenMinuteDETPrice.count = fifteenMinuteDETPrice.count.plus(BigInt.fromI32(1));
  fifteenMinuteDETPrice.averagePrice = calculateAveragePrice(
    fifteenMinuteDETPrice.averagePrice,
    rate,
    fifteenMinuteDETPrice.count
  );

  dailyDETPrice.save();
  fifteenMinuteDETPrice.save();
}

export function handleRatesUpdated(event: RatesUpdatedEvent): void {
  addDollar('dUSD');
  addDollar('nUSD');

  let entity = new RatesUpdated(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.currencyKeys = event.params.currencyKeys;
  entity.newRates = event.params.newRates;
  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.from = event.transaction.from;
  entity.gasPrice = event.transaction.gasPrice;
  entity.save();

  // required due to assemblyscript
  let keys = entity.currencyKeys;
  let rates = entity.newRates;
  // now save each individual update
  for (let i = 0; i < entity.currencyKeys.length; i++) {
    if (keys[i].toString() != '') {
      let rateEntity = new RateUpdate(event.transaction.hash.toHex() + '-' + keys[i].toString());
      rateEntity.block = event.block.number;
      rateEntity.timestamp = event.block.timestamp;
      rateEntity.currencyKey = keys[i];
      rateEntity.synth = keys[i].toString();
      rateEntity.rate = rates[i];
      rateEntity.save();
      if (keys[i].toString() == 'DET') {
        handleDETPrices(event.block.timestamp, rateEntity.rate);
      }
      addLatestRate(rateEntity.synth, rateEntity.rate);
    }
  }
}

function addLatestRate(synth: string, rate: BigInt): void {
  let latestRate = LatestRate.load(synth);
  if (latestRate == null) {
    latestRate = new LatestRate(synth);
  }
  latestRate.rate = rate;
  latestRate.save();
}

function addDollar(dollarID: string): void {
  let dollarRate = LatestRate.load(dollarID);
  if (dollarRate == null) {
    dollarRate = new LatestRate(dollarID);
    let oneDollar = BigInt.fromI32(10);
    dollarRate.rate = oneDollar.pow(18);
    dollarRate.save();
  }
}
