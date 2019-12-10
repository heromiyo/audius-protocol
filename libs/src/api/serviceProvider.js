const _ = require('lodash')
const { Base } = require('./base')
const Utils = require('../utils')

const CREATOR_NODE_SERVICE_NAME = 'creator-node'
const DISCOVERY_PROVIDER_SERVICE_NAME = 'discovery-provider'

/**
 * API methods to interact with Audius service providers.
 * Types of services include:
 *    - Creator Node (host creator content)
 *    - Discovery Provider (index and make content queryable)
 * Retrieving lists of available services, etc. are found here.
 */
class ServiceProvider extends Base {
  /* ------- CREATOR NODE  ------- */

  async listCreatorNodes () {
    return this.ethContracts.ServiceProviderFactoryClient.getServiceProviderList(CREATOR_NODE_SERVICE_NAME)
  }

  /**
   * Fetches healthy creator nodes filtered down to a given whitelist and blacklist
   * @param {Set<string>?} whitelist whether or not to include only specified nodes (default no whiltelist)
   * @param {Set<string?} blacklist whether or not to exclude any nodes (default no blacklist)
   */
  async getSelectableCreatorNodes (
    whitelist = null,
    blacklist = null
  ) {
    let creatorNodes = await this.listCreatorNodes()

    // Filter whitelist
    if (whitelist) {
      creatorNodes = creatorNodes.filter(node => whitelist.has(node.endpoint))
    }
    // Filter blacklist
    if (blacklist) {
      creatorNodes = creatorNodes.filter(node => !blacklist.has(node.endpoint))
    }

    // Time requests and get version info
    const timings = await Utils.timeRequests(
      creatorNodes.map(node => ({
        id: node.endpoint,
        url: `${node.endpoint}/version`
      }))
    )

    let services = {}
    timings.forEach(timing => {
      services[timing.request.id] = timing.response.data
    })

    return services
  }

  /**
   * Fetches healthy creator nodes and autoselects a primary
   * and two secondaries
   * @param {number} numberOfNodes total number of nodes to fetch (2 secondaries means 3 total)
   * @param {Set<string>?} whitelist whether or not to include only specified nodes (default no whiltelist)
   * @param {Set<string?} blacklist whether or not to exclude any nodes (default no blacklist)
   * @returns { primary, secondaries, services }
   * // primary: string
   * // secondaries: Array<string>
   * // services: { creatorNodeEndpoint: versionInfo }
   */
  async autoSelectCreatorNodes (
    numberOfNodes = 3,
    whitelist = null,
    blacklist = null
  ) {
    let creatorNodes = await this.listCreatorNodes()

    // Filter whitelist
    if (whitelist) {
      creatorNodes = creatorNodes.filter(node => whitelist.has(node.endpoint))
    }
    // Filter blacklist
    if (blacklist) {
      creatorNodes = creatorNodes.filter(node => !blacklist.has(node.endpoint))
    }

    // Filter to healthy nodes
    creatorNodes = (await Promise.all(
      creatorNodes.map(async node => {
        try {
          const { isBehind, isConfigured } = await this.creatorNode.getSyncStatus(node.endpoint)
          return isConfigured && isBehind ? false : node.endpoint
        } catch (e) {
          return false
        }
      })
    ))
      .filter(Boolean)

    // Time requests and autoselect nodes
    const timings = await Utils.timeRequests(
      creatorNodes.map(node => ({
        id: node,
        url: `${node}/version`
      }))
    )

    let services = {}
    timings.forEach(timing => {
      services[timing.request.id] = timing.response.data
    })
    // Primary: select the lowest-latency
    const primary = timings[0] ? timings[0].request.id : null

    // Secondaries: select randomly
    // TODO: Implement geolocation-based selection
    const secondaries = _.sampleSize(timings.slice(1), numberOfNodes - 1)
      .map(timing => timing.request.id)

    return { primary, secondaries, services }
  }

  /* ------- DISCOVERY PROVIDER ------ */

  async listDiscoveryProviders () {
    return this.ethContracts.ServiceProviderFactoryClient.getServiceProviderList(DISCOVERY_PROVIDER_SERVICE_NAME)
  }
}

module.exports = ServiceProvider
