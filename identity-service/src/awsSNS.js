const config = require('./config')
const models = require('./models')

// AWS SNS init
const AWS = require('aws-sdk')
const sns = new AWS.SNS({
  accessKeyId: config.get('awsAccessKeyId'),
  secretAccessKey: config.get('awsSecretAccessKey'),
  region: 'us-west-1'
})

// the aws sdk doesn't like when you set the function equal to a variable and try to call it
// eg. const func = sns.<functionname>; func() returns an error, so util.promisify doesn't work
function _promisifySNS (functionName) {
  return function (...args) {
    return new Promise(function (resolve, reject) {
      sns[functionName](...args, function (err, data) {
        if (err) reject(err)
        else resolve(data)
      })
    })
  }
}

/**
 * Formats a push notification in a way that's compatible with SNS
 * @param {String} title title of push notification
 * @param {String} body body of push notification
 * @param {String} targetARN aws arn address for device
 *                           `arn:aws:sns:us-west-1:<id>:endpoint/APNS/<namespace>/<uuid>`
 * @param {Boolean=True} playSound should play a sound when it's sent
 */
function _formatIOSMessage (message, targetARN, playSound = true) {
  let type = null
  if (targetARN.includes('APNS_SANDBOX')) type = 'APNS_SANDBOX'
  else if (targetARN.includes('APNS')) type = 'APNS'

  const jsonMessage = {
    'default': 'You have new notifications in Audius!'
  }

  // set iphone specific properties here
  if (type) {
    let apnsConfig = {
      'aps': {
        'alert': `${message}`
        // keeping these properties here so we can use them if we want to
        // "alert": {
        //   "title" : `${title}`,
        //   "body" : `${body}`
        // },
        // "badge": 19
      }
    }

    jsonMessage[type] = JSON.stringify(apnsConfig)
    if (playSound) jsonMessage[type].sound = 'default'
  }

  var params = {
    Message: JSON.stringify(jsonMessage), /* required */
    MessageStructure: 'json',
    TargetArn: targetARN
  }

  return params
}

const listEndpointsByPlatformApplication = _promisifySNS('listEndpointsByPlatformApplication')
const createPlatformEndpoint = _promisifySNS('createPlatformEndpoint')
const publishPromisified = _promisifySNS('publish')

async function publish (message, userId, playSound = true) {
  const deviceInfo = await models.NotificationDeviceToken.findOne({ where: { userId } })
  if (!deviceInfo) return

  let formattedMessage = null
  if (deviceInfo.deviceType === 'ios') {
    console.log("formattedMessage", formattedMessage)
    formattedMessage = _formatIOSMessage(message, deviceInfo.awsARN, playSound)
  }

  if (formattedMessage) {
    return publishPromisified(formattedMessage)
  } else return null
}

module.exports = {
  listEndpointsByPlatformApplication,
  createPlatformEndpoint,
  publish
}