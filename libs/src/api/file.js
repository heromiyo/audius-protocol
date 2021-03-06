let urlJoin = require('proper-url-join')
if (urlJoin && urlJoin.default) urlJoin = urlJoin.default
const { Base, Services } = require('./base')
const Utils = require('../utils')

// Public gateways to send requests to, ordered by precidence.
const publicGateways = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/'
]

const downloadURL = (url, filename) => {
  if (document) {
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.download = filename
    link.click()
    return
  }
  throw new Error('No body document found')
}

class File extends Base {
  /**
   * Fetches a file from IPFS with a given CID. Public gateways are tried first, then
   * fallback to a specified gateway and then to the default gateway.
   * @param {string} cid IPFS content identifier
   * @param {Array<string>} creatorNodeGateways fallback ipfs gateways from creator nodes
   * @param {?function} callback callback called on each successful/failed fetch with
   *  [String, Bool](gateway, succeeded)
   *  Can be used for tracking metrics on which gateways were used.
   */
  async fetchCID (cid, creatorNodeGateways, callback = null) {
    const gateways = publicGateways
      .concat(creatorNodeGateways)
    const urls = gateways.map(gateway => urlJoin(gateway, cid))

    try {
      return Utils.raceRequests(urls, callback, {
        method: 'get',
        responseType: 'blob'
      })
    } catch (e) {
      throw new Error(`Failed to retrieve ${cid}`)
    }
  }

  /**
   * Fetches a file from IPFS with a given CID. Follows the same pattern
   * as fetchCID, but resolves with a download of the file rather than
   * returning the response content.
   * @param {string} cid IPFS content identifier
   * @param {Array<string>} creatorNodeGateways fallback ipfs gateways from creator nodes
   * @param {string?} filename optional filename for the download
   * @param {boolean?} usePublicGateways
   */
  async downloadCID (cid, creatorNodeGateways, filename, usePublicGateways = false) {
    const gateways = usePublicGateways ? publicGateways.concat(creatorNodeGateways) : creatorNodeGateways
    const urls = gateways.map(gateway => urlJoin(gateway, cid, { query: { filename } }))

    try {
      // Races requests and fires the download callback for the first endpoint to
      // respond with a valid response to a `head` request.
      return Utils.raceRequests(urls, (url) => downloadURL(url, filename), {
        method: 'head'
      }, /* timeout */ 10000)
    } catch (e) {
      throw new Error(`Failed to retrieve ${cid}`)
    }
  }

  /**
   * Uploads an image to the connected creator node.
   * @param {File} file
   */
  async uploadImage (file, square) {
    this.REQUIRES(Services.CREATOR_NODE)
    this.FILE_IS_VALID(file)
    const resp = await this.creatorNode.uploadImage(file, square)
    return resp
  }
}

module.exports = File
