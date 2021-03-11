/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const fs = require('fs');
const path = require('path');
const { gray, yellow, green, red } = require('chalk');
const program = require('commander');

const doesEntryHaveMultidimensionalArrays = ({ type }) => /\[[0-9]*\]\[[0-9]*\]/.test(type);

program.action(async () => {
  const abiPath = path.join(__dirname, 'abis');

  // Get all ABI JSON file names in abis directory
  // TODO: Get all ABIs from dtrade.js module
  const sources = fs.readdirSync(abiPath);

  sources.forEach((contractName) => {
    // Read the JSON content for the file
    let abi = JSON.parse(fs.readFileSync(path.join(abiPath, contractName), 'utf8'));

    if (!abi) {
      console.log(red(`Unable to parse ABI for contract: ${contractName}!`));
      return;
    }

    // Check if ABI contains any multidimensional arrays and strip it
    // https://github.com/graphprotocol/graph-cli/issues/342
    const { name } =
      abi.find(
        ({ inputs = [], outputs = [] }) =>
          inputs.find(doesEntryHaveMultidimensionalArrays) || outputs.find(doesEntryHaveMultidimensionalArrays)
      ) || {};
    if (name) {
      console.log(
        yellow(
          `Note: Found multidimensional array in ABI and stripping it: ${contractName.replace('.json', '')}.${name}`
        )
      );
      abi = abi.filter((entry) => entry.name !== name);
    } else {
      console.log(green('✔') + ` Didn't find any multidimensional array in ABI (${contractName})`);
    }

    // Write the ABI to file
    let targetFile = path.join(abiPath, `${contractName}`);
    console.log(gray('Writing ABI:', `${contractName}`));
    fs.writeFileSync(targetFile, JSON.stringify(abi, null, 2) + '\n');
  });
});

program.parse(process.argv);
