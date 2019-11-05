const axios = require('axios')
const { recoverPersonalSignature } = require('eth-sig-util')

const config = require('./config.js')
const models = require('./models')

const notifDiscProv = config.get('notificationDiscoveryProvider')

/**
 * queryDiscprovForUserId - Queries the discovery provider for the user w/ the walletaddress
 * @param {string} walletAddress
 * @returns {object} User Metadata object
 */
const queryDiscprovForUserId = async (walletAddress) => {
  const response = await axios({
    method: 'get',
    url: `${notifDiscProv}/users`,
    params: {
      wallet: walletAddress
    }
  })

  if (!Array.isArray(response.data.data) || response.data.data.length !== 1) {
    throw new Error('Unable to retrieve user from discovery provder')
  }
  const [user] = response.data.data
  return user
}

/**
 * Authentication Middleware
 * 1) Using the `Encoded-Data-Message` & `Encoded-Data-Signature` header recover the wallet address
 * 2) If a user in the `Users` table with the `walletAddress` value, attach that user to the request
 * 3) Else query the discovery provider for the user's blockchain userId w/ the wallet address & attach to query
 */
async function authMiddleware (req, res, next) {
  try {
    const encodedDataMessage = req.get('Encoded-Data-Message')
    const signature = req.get('Encoded-Data-Signature')

    if (!encodedDataMessage) throw new Error('[Error]: Encoded data missing')
    if (!signature) throw new Error('[Error]: Encoded data signature missing')

    let walletAddress = recoverPersonalSignature({ data: encodedDataMessage, sig: signature })
    const user = await models.User.findOne({
      where: { walletAddress },
      attributes: ['id', 'blockchainUserId']
    })
    if (!user) throw new Error(`[Error]: no user found for wallet address ${walletAddress}`)

    if (user && user.blockchainUserId) {
      req.user = user
      next()
    } else {
      const discprovUser = await queryDiscprovForUserId(walletAddress)
      await user.update({ blockchainUserId: discprovUser.user_id })
      req.user = user
      next()
    }
  } catch (err) {
    console.log(err)
    throw new Error('[Error]: The wallet address is not associated with a user id')
  }
}

module.exports = authMiddleware
