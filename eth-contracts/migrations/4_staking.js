const abi = require('ethereumjs-abi')
const contractConfig = require('../contract-config.js')

const Staking = artifacts.require('Staking')
const Registry = artifacts.require('Registry')
const AudiusToken = artifacts.require('AudiusToken')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy')

const ownedUpgradeabilityProxyKey = web3.utils.utf8ToHex('OwnedUpgradeabilityProxy')

function encodeCall (name, args, values) {
  const methodId = abi.methodID(name, args).toString('hex')
  const params = abi.rawEncode(args, values).toString('hex')
  return '0x' + methodId + params
}

module.exports = (deployer, network, accounts) => {
  deployer.then(async () => {
    let registry = await Registry.deployed()

    // const networkId = Registry.network_id
    const config = contractConfig[network]
    const treasuryAddress = config.treasuryAddress || accounts[0]

    // const token = await AudiusToken.deployed()
    let staking = await deployer.deploy(Staking)
    let ownedUpgradeabilityProxy = await deployer.deploy(OwnedUpgradeabilityProxy)

    // Register proxy for access by service provider factory
    await registry.addContract(
      ownedUpgradeabilityProxyKey,
      ownedUpgradeabilityProxy.address)

    let tokenAddress = '0x65ca91574256b2c194a964e340e8b0a802e17ec6'

    // Encode data for the call to initialize
    let initializeData = encodeCall(
      'initialize',
      ['address', 'address'],
      [tokenAddress, treasuryAddress])

    let contractDeployer = accounts[0]

    // Initialize staking proxy
    await ownedUpgradeabilityProxy.upgradeToAndCall(
      staking.address,
      initializeData,
      { from: contractDeployer })
  })
}
