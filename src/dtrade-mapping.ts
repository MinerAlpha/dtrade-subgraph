// The latest Dtrade and event invocations
import { dTrade as DET, Transfer as DETTransferEvent } from '../generated/dTrade/dTrade';

import { AddressResolver } from '../generated/dTrade/AddressResolver';

import { dUSD32, dUSD4 } from './common';

import { dTradeState } from '../generated/dTrade/dTradeState';

import { TargetUpdated as TargetUpdatedEvent } from '../generated/ProxydTradeERC20/Proxy';

import { Vested as VestedEvent, RewardEscrow } from '../generated/RewardEscrow/RewardEscrow';

import {
  Synth,
  Transfer as SynthTransferEvent,
  Issued as IssuedEvent,
  Burned as BurnedEvent
} from '../generated/SynthsUSD/Synth';

import { FeesClaimed as FeesClaimedEvent } from '../generated/FeePool/FeePool';

// import { FeePoolv217 } from '../generated/FeePool/FeePoolv217';

import {
  Dtrade,
  Transfer,
  Issued,
  Burned,
  Issuer,
  ContractUpdated,
  DETHolder,
  DebtSnapshot,
  SynthHolder,
  RewardEscrowHolder,
  FeesClaimed,
  TotalActiveStaker,
  TotalDailyActiveStaker,
  ActiveStaker
} from '../generated/schema';

import { store, BigInt, Address, ethereum, Bytes } from '@graphprotocol/graph-ts';

import { strToBytes } from './common';

import { log } from '@graphprotocol/graph-ts';

let contracts = new Map<string, string>();
contracts.set('escrow', '0x971e78e0c92392a4e39099835cf7e6ab535b2227');
contracts.set('rewardEscrow', '0xb671f2210b1f6621a2607ea63e6b2dc3e2464d1f');

let v219UpgradeBlock = BigInt.fromI32(9518914); // Archernar v2.19.x Feb 20, 2020

// [reference only] Dtrade v2.10.x (bytes4 to bytes32) at txn
// https://etherscan.io/tx/0x612cf929f305af603e165f4cb7602e5fbeed3d2e2ac1162ac61087688a5990b6
let v2100UpgradeBlock = BigInt.fromI32(8622911);

// https://etherscan.io/tx/0x4b5864b1e4fdfe0ab9798de27aef460b124e9039a96d474ed62bd483e10c835a
let v200UpgradeBlock = BigInt.fromI32(6841188); // Dec 7, 2018

// Havven v1.0.1 release at txn
// https://etherscan.io/tx/0x7d5e4d92c702d4863ed71d5c1348e9dec028afd8d165e673d4b6aea75c8b9e2c
// let v101UpgradeBlock = BigInt.fromI32(5873222); // June 29, 2018 (nUSDa.1)

function getMetadata(): Dtrade {
  let dtrade = Dtrade.load('1');

  if (dtrade == null) {
    dtrade = new Dtrade('1');
    dtrade.issuers = BigInt.fromI32(0);
    dtrade.detHolders = BigInt.fromI32(0);
    dtrade.save();
  }

  return dtrade as Dtrade;
}

function incrementMetadata(field: string): void {
  let metadata = getMetadata();
  if (field == 'issuers') {
    metadata.issuers = metadata.issuers.plus(BigInt.fromI32(1));
  } else if (field == 'detHolders') {
    metadata.detHolders = metadata.detHolders.plus(BigInt.fromI32(1));
  }
  metadata.save();
}

function decrementMetadata(field: string): void {
  let metadata = getMetadata();
  if (field == 'issuers') {
    metadata.issuers = metadata.issuers.minus(BigInt.fromI32(1));
  } else if (field == 'detHolders') {
    metadata.detHolders = metadata.detHolders.minus(BigInt.fromI32(1));
  }
  metadata.save();
}

function trackIssuer(account: Address): void {
  let existingIssuer = Issuer.load(account.toHex());
  if (existingIssuer == null) {
    incrementMetadata('issuers');
    let issuer = new Issuer(account.toHex());
    issuer.save();
  }
}

function trackDETHolder(
  detContract: Address,
  account: Address,
  block: ethereum.Block,
  txn: ethereum.Transaction
): void {
  log.debug('1. Entered trackDETHolder..', [
    detContract.toHex(),
    account.toHex(),
    block.number.toString(),
    txn.hash.toHex()
  ]);

  let holder = account.toHex();
  // ignore escrow accounts
  if (contracts.get('escrow') == holder || contracts.get('rewardEscrow') == holder) {
    log.debug('2. escrow check failed..', [holder, contracts.get('escrow'), contracts.get('rewardEscrow')]);
    return;
  }

  let existingDETolder = DETHolder.load(holder);
  let uniqueVal = block.timestamp.toString() + '-' + holder.toString();
  let detHolder = new DETHolder(uniqueVal.toString());
  detHolder.block = block.number;
  detHolder.timestamp = block.timestamp;
  detHolder.account = holder.toString();

  let dtrade = DET.bind(detContract);
  detHolder.balanceOf = dtrade.balanceOf(account);
  detHolder.collateral = dtrade.collateral(account);

  // Check transferable because it will be null when rates are stale
  let transferableTry = dtrade.try_transferabledTrade(account);
  if (!transferableTry.reverted) {
    detHolder.transferable = transferableTry.value;
  }
  let resolverTry = dtrade.try_resolver();
  if (resolverTry.reverted) {
    // This happened when an old DET token was reconnected to the old proxy temporarily to recover 25k DET
    // from the old grantsDAO:
    // https://etherscan.io/tx/0x1f862d93373e6d5dbf2438f478c05eac67b2949664bf1b3e6a5b6d5adf92fb3c
    // https://etherscan.io/tx/0x84b4e312188890d744f6912f1e5d3387e2bf314a335a4418980a938e36b3ef34
    // In this case, the old Dtrade did not have a resolver property, so let's ignore
    log.debug('Skipping DET holder tracking: No resolver property from DET holder from hash: {}, block: {}', [
      txn.hash.toHex(),
      block.number.toString()
    ]);
    return;
  }
  let resolverAddress = resolverTry.value;
  let resolver = AddressResolver.bind(resolverAddress);
  let _dTradeState = dTradeState.bind(resolver.getAddress(strToBytes('dTradeState', 32)));
  let issuanceData = _dTradeState.issuanceData(account);
  detHolder.initialDebtOwnership = issuanceData.value0;

  // Note: due to limitations with how The Graph deals with chain reorgs, we need to try_debtLedger
  /*
      From Jannis at The Graph:
      graph-node currently makes contract calls by block number (that used to be the only way
      to do it and we haven't switched to calling by block hash yet). If there is a reorg,
      this may lead to making calls against a different block than expected.
      If the subgraph doesn't fail on such a call, the resulting data should be reverted as
      soon as the reorg is detected (e.g. when processing the next block). It can temporarily
      cause inconsistent data until that happens.
      However, if such a call fails (e.g. you're expecting an array to have grown by one but
      in the fork of the chain it hasn't and the call doesn't use try_), then this can cause
      the subgraph to fail.
      Here's what happens during a reorg:
      - Block 0xa (block number 100) is being processed.
      - A handler makes a try_debtLedger call against block number 100 but hits block 0xb instead of 0xa.
      - The result gets written to the store marked with block 0xa (because that's what we're processing).
      - The reorg is detected: block number 100 is no longer 0xa, it's 0xb
      - The changes made for 0xa (including the inconsistent/incorrect try_debtLedger result) are reverted.
      - Block 0xb is processed. The handler now makes the try_debtLedger call against 100 -> 0xb and the correct data is being returned
  */

  let debtLedgerTry = _dTradeState.try_debtLedger(issuanceData.value1);
  if (!debtLedgerTry.reverted) {
    detHolder.debtEntryAtIndex = debtLedgerTry.value;
  }

  // // // Don't bother trying these extra fields before v2 upgrade (slows down The Graph processing to do all these as try_ calls)
  // if (block.number > v219UpgradeBlock) {
  //   let dtrade = DET.bind(detContract);
  //   detHolder.balanceOf = dtrade.balanceOf(account);
  //   detHolder.collateral = dtrade.collateral(account);

  //   // Check transferable because it will be null when rates are stale
  //   let transferableTry = dtrade.try_transferabledTrade(account);
  //   if (!transferableTry.reverted) {
  //     detHolder.transferable = transferableTry.value;
  //   }
  //   let resolverTry = dtrade.try_resolver();
  //   if (resolverTry.reverted) {
  //     // This happened when an old DET token was reconnected to the old proxy temporarily to recover 25k DET
  //     // from the old grantsDAO:
  //     // https://etherscan.io/tx/0x1f862d93373e6d5dbf2438f478c05eac67b2949664bf1b3e6a5b6d5adf92fb3c
  //     // https://etherscan.io/tx/0x84b4e312188890d744f6912f1e5d3387e2bf314a335a4418980a938e36b3ef34
  //     // In this case, the old Dtrade did not have a resolver property, so let's ignore
  //     log.debug('Skipping DET holder tracking: No resolver property from DET holder from hash: {}, block: {}', [
  //       txn.hash.toHex(),
  //       block.number.toString()
  //     ]);
  //     return;
  //   }
  //   let resolverAddress = resolverTry.value;
  //   let resolver = AddressResolver.bind(resolverAddress);
  //   let _dTradeState = dTradeState.bind(resolver.getAddress(strToBytes('dTradeState', 32)));
  //   let issuanceData = _dTradeState.issuanceData(account);
  //   detHolder.initialDebtOwnership = issuanceData.value0;

  //   // Note: due to limitations with how The Graph deals with chain reorgs, we need to try_debtLedger
  //   /*
  //       From Jannis at The Graph:
  //       graph-node currently makes contract calls by block number (that used to be the only way
  //       to do it and we haven't switched to calling by block hash yet). If there is a reorg,
  //       this may lead to making calls against a different block than expected.
  //       If the subgraph doesn't fail on such a call, the resulting data should be reverted as
  //       soon as the reorg is detected (e.g. when processing the next block). It can temporarily
  //       cause inconsistent data until that happens.
  //       However, if such a call fails (e.g. you're expecting an array to have grown by one but
  //       in the fork of the chain it hasn't and the call doesn't use try_), then this can cause
  //       the subgraph to fail.
  //       Here's what happens during a reorg:
  //       - Block 0xa (block number 100) is being processed.
  //       - A handler makes a try_debtLedger call against block number 100 but hits block 0xb instead of 0xa.
  //       - The result gets written to the store marked with block 0xa (because that's what we're processing).
  //       - The reorg is detected: block number 100 is no longer 0xa, it's 0xb
  //       - The changes made for 0xa (including the inconsistent/incorrect try_debtLedger result) are reverted.
  //       - Block 0xb is processed. The handler now makes the try_debtLedger call against 100 -> 0xb and the correct data is being returned
  //   */

  //   let debtLedgerTry = _dTradeState.try_debtLedger(issuanceData.value1);
  //   if (!debtLedgerTry.reverted) {
  //     detHolder.debtEntryAtIndex = debtLedgerTry.value;
  //   }
  // } else if (block.number > v200UpgradeBlock) {
  //   // Dtrade32 or Dtrade4
  //   let dtrade = Dtrade32.bind(detContract);
  //   // Track all the staking information relevant to this DET Holder
  //   detHolder.balanceOf = dtrade.balanceOf(account);
  //   detHolder.collateral = dtrade.collateral(account);
  //   // Note: Below we try_transferableDtrade as it uses debtBalanceOf, which eventually calls ExchangeRates.abs
  //   // It's slower to use try but this protects against instances when Transfers were enabled
  //   // yet ExchangeRates were stale and throwing errors when calling effectiveValue.
  //   // E.g. https://etherscan.io/tx/0x5368339311aafeb9f92c5b5d84faa4864c2c3878681a402bbf0aabff60bafa08
  //   let transferableTry = dtrade.try_transferableDtrade(account);
  //   if (!transferableTry.reverted) {
  //     detHolder.transferable = transferableTry.value;
  //   }
  //   let stateTry = dtrade.try_dtradeState();
  //   if (!stateTry.reverted) {
  //     let dtradeStateContract = dtrade.dtradeState();
  //     let dtradeState = dTradeState.bind(dtradeStateContract);
  //     let issuanceData = dtradeState.issuanceData(account);
  //     detHolder.initialDebtOwnership = issuanceData.value0;
  //     let debtLedgerTry = dtradeState.try_debtLedger(issuanceData.value1);
  //     if (!debtLedgerTry.reverted) {
  //       detHolder.debtEntryAtIndex = debtLedgerTry.value;
  //     }
  //   }
  // } else if (block.number > v101UpgradeBlock) {
  //   // When we were Havven, simply track their collateral (DET balance and escrowed balance)
  //   let dtrade = Dtrade4.bind(detContract); // not the correct ABI/contract for pre v2 but should suffice
  //   detHolder.balanceOf = dtrade.balanceOf(account);
  //   let collateralTry = dtrade.try_collateral(account);
  //   if (!collateralTry.reverted) {
  //     detHolder.collateral = collateralTry.value;
  //   }
  // } else {
  //   let dtrade = Dtrade4.bind(detContract); // not the correct ABI/contract for pre v2 but should suffice
  //   detHolder.balanceOf = dtrade.balanceOf(account);
  // }

  if (
    (existingDETolder == null && detHolder.balanceOf > BigInt.fromI32(0)) ||
    (existingDETolder != null &&
      existingDETolder.balanceOf == BigInt.fromI32(0) &&
      detHolder.balanceOf > BigInt.fromI32(0))
  ) {
    incrementMetadata('detHolders');
  } else if (
    existingDETolder != null &&
    existingDETolder.balanceOf > BigInt.fromI32(0) &&
    detHolder.balanceOf == BigInt.fromI32(0)
  ) {
    decrementMetadata('detHolders');
  }

  log.debug('3. Saving detHolder..', [detHolder.account, detHolder.balanceOf.toString()]);

  detHolder.save();
}

function trackDebtSnapshot(event: ethereum.Event): void {
  let detContract = event.transaction.to as Address;
  let account = event.transaction.from;

  // ignore escrow accounts
  if (contracts.get('escrow') == account.toHex() || contracts.get('rewardEscrow') == account.toHex()) {
    return;
  }

  let entity = new DebtSnapshot(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.block = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.account = account;

  let dtrade = DET.bind(detContract);
  entity.balanceOf = dtrade.balanceOf(account);
  entity.collateral = dtrade.collateral(account);
  entity.debtBalanceOf = dtrade.debtBalanceOf(account, dUSD32);

  // Use bytes32
  // if (event.block.number > v2100UpgradeBlock) {
  //   let dtrade = DET.bind(detContract);
  //   entity.balanceOf = dtrade.balanceOf(account);
  //   entity.collateral = dtrade.collateral(account);
  //   entity.debtBalanceOf = dtrade.debtBalanceOf(account, dUSD32);
  //   // Use bytes4
  // } else if (event.block.number > v101UpgradeBlock) {
  //   let dtrade = Dtrade4.bind(detContract); // not the correct ABI/contract for pre v2 but should suffice
  //   let balanceOfTry = dtrade.try_balanceOf(account);
  //   if (!balanceOfTry.reverted) {
  //     entity.balanceOf = balanceOfTry.value;
  //   }
  //   let collateralTry = dtrade.try_collateral(account);
  //   if (!collateralTry.reverted) {
  //     entity.collateral = collateralTry.value;
  //   }
  //   let debtBalanceOfTry = dtrade.try_debtBalanceOf(account, dUSD4);
  //   if (!debtBalanceOfTry.reverted) {
  //     entity.debtBalanceOf = debtBalanceOfTry.value;
  //   }
  // } else {
  //   return;
  // }

  entity.save();
}

export function handleTransferDET(event: DETTransferEvent): void {
  let entity = new Transfer(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.source = 'DET';
  entity.from = event.params.from;
  entity.to = event.params.to;
  entity.value = event.params.value;
  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.save();

  log.debug('in handleTransferDET', []);

  trackDETHolder(event.address, event.params.from, event.block, event.transaction);
  trackDETHolder(event.address, event.params.to, event.block, event.transaction);
}

function trackSynthHolder(contract: Synth, source: string, account: Address): void {
  let entityID = account.toHex() + '-' + source;
  let entity = SynthHolder.load(entityID);
  if (entity == null) {
    entity = new SynthHolder(entityID);
  }
  entity.synth = source;
  entity.balanceOf = contract.balanceOf(account);
  entity.save();
}

export function handleTransferSynth(event: SynthTransferEvent): void {
  let contract = Synth.bind(event.address);
  let entity = new Transfer(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.source = 'dUSD';
  // if (event.block.number > v200UpgradeBlock) {
  //   // dUSD contract didn't have the "currencyKey" field prior to the v2 (multicurrency) release
  //   let currencyKeyTry = contract.try_currencyKey();
  //   if (!currencyKeyTry.reverted) {
  //     entity.source = currencyKeyTry.value.toString();
  //   }
  // }
  entity.from = event.params.from;
  entity.to = event.params.to;
  entity.value = event.params.value;
  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.save();

  trackSynthHolder(contract, entity.source, event.params.from);
  trackSynthHolder(contract, entity.source, event.params.to);
}

/**
 * Track when underlying contracts change
 */
function contractUpdate(source: string, target: Address, block: ethereum.Block, hash: Bytes): void {
  let entity = new ContractUpdated(hash.toHex());
  entity.source = source;
  entity.target = target;
  entity.block = block.number;
  entity.timestamp = block.timestamp;
  entity.save();
}

export function handleProxyTargetUpdated(event: TargetUpdatedEvent): void {
  contractUpdate('Dtrade', event.params.newTarget, event.block, event.transaction.hash);
}

// export function handleSetExchangeRates(call: SetExchangeRatesCall): void {
//   contractUpdate('ExchangeRates', call.inputs._exchangeRates, call.block, call.transaction.hash);
// }

// export function handleSetFeePool(call: SetFeePoolCall): void {
//   contractUpdate('FeePool', call.inputs._feePool, call.block, call.transaction.hash);
// }

/**
 * Handle reward vest events so that we know which addresses have rewards, and
 * to recalculate DET Holders staking details.
 */
// Note: we use VestedEvent here even though is also handles VestingEntryCreated (they share the same signature)
export function handleRewardVestEvent(event: VestedEvent): void {
  let entity = new RewardEscrowHolder(event.params.beneficiary.toHex());
  let contract = RewardEscrow.bind(event.address);
  entity.balanceOf = contract.balanceOf(event.params.beneficiary);
  entity.save();
  // now track the DET holder as this action can impact their collateral
  let dtradeAddress = contract.dtrade();
  trackDETHolder(dtradeAddress, event.params.beneficiary, event.block, event.transaction);
}

export function handleIssuedSynths(event: IssuedEvent): void {
  // We need to figure out if this was generated from a call to Dtrade.issueSynths, issueMaxSynths or any earlier
  // versions.

  let functions = new Map<string, string>();

  functions.set('0xaf086c7e', 'issueMaxSynths()');
  functions.set('0x320223db', 'issueMaxSynthsOnBehalf(address)');
  functions.set('0x8a290014', 'issueSynthsForERC20(uint256)');
  functions.set('0xe8e09b8b', 'issueSynthsOnBehalf(address,uint256');

  let input = event.transaction.input.subarray(0, 4) as Bytes;

  // and for any function calls that don't match our mapping, we ignore them
  if (!functions.has(input.toHexString())) {
    log.debug('**NOT** Ignoring Issued event with input: {}, hash: {}, address: {}', [
      event.transaction.input.toHexString(),
      event.transaction.hash.toHex(),
      event.address.toHexString()
    ]);

    // Removing this for now
    // return;
  }

  let entity = new Issued(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.account = event.transaction.from;

  // Note: this amount isn't in dUSD for sETH or sBTC issuance prior to Vega
  entity.value = event.params.value;

  let synth = Synth.bind(event.address);
  let currencyKeyTry = synth.try_currencyKey();
  if (!currencyKeyTry.reverted) {
    entity.source = currencyKeyTry.value.toString();
  } else {
    entity.source = 'dUSD';
  }

  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.gasPrice = event.transaction.gasPrice;
  entity.save();

  // if (event.block.number > v200UpgradeBlock) {
  //   trackActiveStakers(event, false);
  // }

  // track this issuer for reference
  trackIssuer(event.transaction.from);

  // update DET holder details
  trackDETHolder(event.transaction.to as Address, event.transaction.from, event.block, event.transaction);

  // now update DETHolder to increment the number of claims
  let detHolder = DETHolder.load(entity.account.toHexString());
  if (detHolder != null) {
    if (detHolder.mints == null) {
      detHolder.mints = BigInt.fromI32(0);
    }
    detHolder.mints = detHolder.mints.plus(BigInt.fromI32(1));
    detHolder.save();
  }

  // update Debt snapshot history
  trackDebtSnapshot(event);
}

export function handleBurnedSynths(event: BurnedEvent): void {
  // We need to figure out if this was generated from a call to Dtrade.burnSynths, burnSynthsToTarget or any earlier
  // versions.

  let functions = new Map<string, string>();
  functions.set('0x295da87d', 'burnSynths(uint256)');
  functions.set('0xc2bf3880', 'burnSynthsOnBehalf(address,uint256');
  functions.set('0x9741fb22', 'burnSynthsToTarget()');
  functions.set('0x2c955fa7', 'burnSynthsToTargetOnBehalf(address)');

  // // Prior to Vega we had the currency key option in issuance
  // functions.set('0xea168b62', 'burnSynths(bytes32,uint256)');

  // // Prior to Sirius release, we had currency keys using bytes4
  // functions.set('0xaf023335', 'burnSynths(bytes4,uint256)');

  // // Prior to v2 (i.e. in Havven times)
  // functions.set('0x3253ccdf', 'burnNomins(uint256');

  // so take the first four bytes of input
  let input = event.transaction.input.subarray(0, 4) as Bytes;

  // and for any function calls that don't match our mapping, we ignore them
  if (!functions.has(input.toHexString())) {
    log.debug('Ignoring Burned event with input: {}, hash: {}, address: {}', [
      event.transaction.input.toHexString(),
      event.transaction.hash.toHex(),
      event.address.toHexString()
    ]);
    return;
  }

  let entity = new Burned(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
  entity.account = event.transaction.from;

  // Note: this amount isn't in dUSD for sETH or sBTC issuance prior to Vega
  entity.value = event.params.value;

  let synth = Synth.bind(event.address);
  let currencyKeyTry = synth.try_currencyKey();
  if (!currencyKeyTry.reverted) {
    entity.source = currencyKeyTry.value.toString();
  } else {
    entity.source = 'dUSD';
  }

  entity.timestamp = event.block.timestamp;
  entity.block = event.block.number;
  entity.gasPrice = event.transaction.gasPrice;
  entity.save();

  // if (event.block.number > v200UpgradeBlock) {
  //   trackActiveStakers(event, true);
  // }

  // update DET holder details
  trackDETHolder(event.transaction.to as Address, event.transaction.from, event.block, event.transaction);
  // update Debt snapshot history
  trackDebtSnapshot(event);
}

export function handleFeesClaimed(event: FeesClaimedEvent): void {
  let entity = new FeesClaimed(event.transaction.hash.toHex() + '-' + event.logIndex.toString());

  entity.account = event.params.account;
  entity.rewards = event.params.detRewards;

  entity.value = event.params.dUSDAmount;

  // if (event.block.number > v219UpgradeBlock) {
  //   // post Achernar, we had no XDRs, so use the value as dUSD
  //   entity.value = event.params.dUSDAmount;
  // } else {
  //   // pre Achernar, we had XDRs, so we need to figure out their effective value,
  //   // and for that we need to get to dtrade, which in pre-Achernar was exposed
  //   // as a public dtrade property on FeePool
  //   let feePool = FeePoolv217.bind(event.address);

  //   if (event.block.number > v2100UpgradeBlock) {
  //     // use bytes32
  //     let dtrade = Dtrade32.bind(feePool.dtrade());
  //     // Note: the event param is called "dUSDAmount" because we are using the latest ABI to handle events
  //     // from both newer and older invocations. Since the event signature of FeesClaimed hasn't changed between versions,
  //     // we can reuse it, but accept that the variable naming uses the latest ABI
  //     let tryEffectiveValue = dtrade.try_effectiveValue(
  //       strToBytes('XDR', 32),
  //       event.params.dUSDAmount,
  //       strToBytes('dUSD', 32)
  //     );

  //     if (!tryEffectiveValue.reverted) {
  //       entity.value = tryEffectiveValue.value;
  //     } else {
  //       entity.value = BigInt.fromI32(0); // Note: not sure why this might be happening. Need to investigat
  //     }
  //   } else {
  //     // use bytes4
  //     let dtrade = Dtrade4.bind(feePool.dtrade());
  //     entity.value = dtrade.effectiveValue(strToBytes('XDR', 4), event.params.dUSDAmount, strToBytes('dUSD', 4));
  //   }
  // }

  entity.block = event.block.number;
  entity.timestamp = event.block.timestamp;

  entity.save();

  // now update DETHolder to increment the number of claims
  let detHolder = DETHolder.load(entity.account.toHexString());
  if (detHolder != null) {
    if (detHolder.claims == null) {
      detHolder.claims = BigInt.fromI32(0);
    }
    detHolder.claims = detHolder.claims.plus(BigInt.fromI32(1));
    detHolder.save();
  }
}

function trackActiveStakers(event: ethereum.Event, isBurn: boolean): void {
  let account = event.transaction.from;
  let timestamp = event.block.timestamp;
  let detContract = event.transaction.to as Address;
  let accountDebtBalance = BigInt.fromI32(0);

  let dtrade = DET.bind(detContract);
  accountDebtBalance = dtrade.debtBalanceOf(account, dUSD32);

  // if (event.block.number > v2100UpgradeBlock) {
  //   let dtrade = DET.bind(detContract);
  //   accountDebtBalance = dtrade.debtBalanceOf(account, dUSD32);
  // } else if (event.block.number > v200UpgradeBlock) {
  //   let dtrade = Dtrade4.bind(detContract);
  //   let accountDebt = dtrade.try_debtBalanceOf(account, dUSD4);
  //   if (!accountDebt.reverted) {
  //     accountDebtBalance = accountDebt.value;
  //   } else {
  //     log.debug('reverted debt balance of in track active stakers for account: {}, timestamp: {}, hash: {}', [
  //       account.toHex(),
  //       timestamp.toString(),
  //       event.transaction.hash.toHex()
  //     ]);
  //     return;
  //   }
  // }

  let dayID = timestamp.toI32() / 86400;

  let totalActiveStaker = TotalActiveStaker.load('1');
  let activeStaker = ActiveStaker.load(account.toHex());

  if (totalActiveStaker == null) {
    totalActiveStaker = loadTotalActiveStaker();
  }

  // You are burning and have been counted before as active and have no debt balance
  // we reduce the count from the total and remove the active staker entity
  if (isBurn && activeStaker != null && accountDebtBalance == BigInt.fromI32(0)) {
    totalActiveStaker.count = totalActiveStaker.count.minus(BigInt.fromI32(1));
    totalActiveStaker.save();
    store.remove('ActiveStaker', account.toHex());
    // else if you are minting and have not been accounted for as being active, add one
    // and create a new active staker entity
  } else if (!isBurn && activeStaker == null) {
    activeStaker = new ActiveStaker(account.toHex());
    activeStaker.save();
    totalActiveStaker.count = totalActiveStaker.count.plus(BigInt.fromI32(1));
    totalActiveStaker.save();
  }

  // Once a day we stor the total number of active stakers in an entity that is easy to query for charts
  let totalDailyActiveStaker = TotalDailyActiveStaker.load(dayID.toString());
  if (totalDailyActiveStaker == null) {
    updateTotalDailyActiveStaker(dayID.toString(), totalActiveStaker.count);
  }
}

function loadTotalActiveStaker(): TotalActiveStaker {
  let newActiveStaker = new TotalActiveStaker('1');
  newActiveStaker.count = BigInt.fromI32(0);
  return newActiveStaker;
}

function updateTotalDailyActiveStaker(id: string, count: BigInt): void {
  let newTotalDailyActiveStaker = new TotalDailyActiveStaker(id);
  newTotalDailyActiveStaker.count = count;
  newTotalDailyActiveStaker.save();
}
