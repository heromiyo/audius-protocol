const Utils = require('../../utils')

// load classes wrapping contracts
const RegistryClient = require('./registryClient')
const UserFactoryClient = require('./userFactoryClient')
const TrackFactoryClient = require('./trackFactoryClient')
const SocialFeatureFactoryClient = require('./socialFeatureFactoryClient')
const PlaylistFactoryClient = require('./playlistFactoryClient')
const UserLibraryFactoryClient = require('./userLibraryFactoryClient')
const IPLDBlacklistFactoryClient = require('./IPLDBlacklistFactoryClient')

// Make sure the json file exists before importing because it could silently fail
// import data contract ABI's
const RegistryABI = Utils.importDataContractABI('Registry.json').abi
const UserFactoryABI = Utils.importDataContractABI('UserFactory.json').abi
const TrackFactoryABI = Utils.importDataContractABI('TrackFactory.json').abi
const SocialFeatureFactoryABI = Utils.importDataContractABI('SocialFeatureFactory.json').abi
const PlaylistFactoryABI = Utils.importDataContractABI('PlaylistFactory.json').abi
const UserLibraryFactoryABI = Utils.importDataContractABI('UserLibraryFactory.json').abi
const IPLDBlacklistFactoryABI = Utils.importDataContractABI('IPLDBlacklistFactory.json').abi

// define contract registry keys
const UserFactoryRegistryKey = 'UserFactory'
const TrackFactoryRegistryKey = 'TrackFactory'
const SocialFeatureFactoryRegistryKey = 'SocialFeatureFactory'
const PlaylistFactoryRegistryKey = 'PlaylistFactory'
const UserLibraryFactoryRegistryKey = 'UserLibraryFactory'
const IPLDBlacklistFactoryRegistryKey = 'IPLDBlacklistFactory'

class AudiusContracts {
  constructor (web3Manager, registryAddress, isServer) {
    this.web3Manager = web3Manager
    this.registryAddress = registryAddress
    this.isServer = isServer

    this.RegistryClient = new RegistryClient(
      this.web3Manager,
      RegistryABI,
      this.registryAddress
    )
    this.getRegistryAddressForContract = this.getRegistryAddressForContract.bind(this)

    this.UserFactoryClient = new UserFactoryClient(
      this.web3Manager,
      UserFactoryABI,
      UserFactoryRegistryKey,
      this.getRegistryAddressForContract
    )

    this.TrackFactoryClient = new TrackFactoryClient(
      this.web3Manager,
      TrackFactoryABI,
      TrackFactoryRegistryKey,
      this.getRegistryAddressForContract
    )

    this.SocialFeatureFactoryClient = new SocialFeatureFactoryClient(
      this.web3Manager,
      SocialFeatureFactoryABI,
      SocialFeatureFactoryRegistryKey,
      this.getRegistryAddressForContract
    )

    this.PlaylistFactoryClient = new PlaylistFactoryClient(
      this.web3Manager,
      PlaylistFactoryABI,
      PlaylistFactoryRegistryKey,
      this.getRegistryAddressForContract
    )

    this.UserLibraryFactoryClient = new UserLibraryFactoryClient(
      this.web3Manager,
      UserLibraryFactoryABI,
      UserLibraryFactoryRegistryKey,
      this.getRegistryAddressForContract
    )

    this.IPLDBlacklistFactoryClient = new IPLDBlacklistFactoryClient(
      this.web3Manager,
      IPLDBlacklistFactoryABI,
      IPLDBlacklistFactoryRegistryKey,
      this.getRegistryAddressForContract
    )

    this.contractClients = [
      this.UserFactoryClient,
      this.TrackFactoryClient,
      this.SocialFeatureFactoryClient,
      this.PlaylistFactoryClient,
      this.UserLibraryFactoryClient,
      this.IPLDBlacklistFactoryClient
    ]
  }

  async init () {
    if (this.isServer) {
      await Promise.all(this.contractClients.map(client => client.init()))
    }
  }

  /* ------- CONTRACT META-FUNCTIONS ------- */

  async getRegistryAddressForContract (contractName) {
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Object_initializer#Computed_property_names
    this.contracts = this.contracts || { [this.registryAddress]: 'registry' }
    this.contractAddresses = this.contractAddresses || { 'registry': this.registryAddress }
    if (!this.contractAddresses[contractName]) {
      const address = await this.RegistryClient.getContract(contractName)
      this.contracts[address] = contractName
      this.contractAddresses[contractName] = address
    }
    return this.contractAddresses[contractName]
  }

  async getRegistryContractForAddress (address) {
    if (!this.contracts) {
      throw new Error('No contracts found. Have you called init() yet?')
    }
    const contractRegistryKey = this.contracts[address]
    if (!contractRegistryKey) {
      throw new Error(`No registry contract found for contract address ${address}`)
    }
    return contractRegistryKey
  }
}

module.exports = AudiusContracts
