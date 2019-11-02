const Bull = require('bull')
const config = require('../config.js')
const models = require('../models')
const axios = require('axios')

const notificationTypes = {
  Follow: 'Follow',
  Repost: {
    base: 'Repost',
    track: 'RepostTrack',
    album: 'RepostAlbum',
    playlist: 'RepostPlaylist'
  },
  Favorite: {
    base: 'Favorite',
    track: 'FavoriteTrack',
    album: 'FavoriteAlbum',
    playlist: 'FavoritePlaylist'
  },
  Create: {
    base: 'Create',
    track: 'CreateTrack',
    album: 'CreateAlbum',
    playlist: 'CreatePlaylist'
  }
}

const actionEntityTypes = {
  User: 'User',
  Track: 'Track',
  Album: 'Album',
  Playlist: 'Playlist'
}

const notificationJobType = 'notificationProcessJob'
const milestoneJobType = 'milestoneProcessJob'

let notifDiscProv = config.get('notificationDiscoveryProvider')

class NotificationProcessor {
  constructor () {
    this.notifQueue = new Bull(
      'notification-queue',
      { redis:
        { port: config.get('redisPort'), host: config.get('redisHost') }
      })
    this.milestoneQueue = new Bull(
      'milestone-queue',
      { redis:
        { port: config.get('redisPort'), host: config.get('redisHost') }
      })
    this.startBlock = config.get('notificationStartBlock')
  }

  // TODO: Add Queue diagnostic to health_check or notif_check

  async init (audiusLibs) {
    // Clear any pending notif jobs
    await this.notifQueue.empty()
    await this.milestoneQueue.empty()

    // TODO: Eliminate this in favor of disc prov libs call
    // TODO: audiusLibs disc prov method update to include notificaitons
    this.audiusLibs = audiusLibs

    this.notifQueue.process(async (job, done) => {
      // Temporary delay
      await new Promise(resolve => setTimeout(resolve, 3000))
      let minBlock = job.data.minBlock
      if (!minBlock) throw new Error('no min block')

      try {
        // Index notifications
        let notifStats = await this.indexNotifications(minBlock)

        // Restart job with updated startBlock
        await this.notifQueue.add({
          type: notificationJobType,
          minBlock: notifStats.maxBlockNumber
        })

        if (
          notifStats.followersAdded.length > 0
        ) {
          // Add milestone processing job
          this.milestoneQueue.add({
            type: milestoneJobType,
            userInfo: notifStats
          })
        }
      } catch (e) {
        console.log(`Restarting due to error indexing notifications : ${e}`)
        // Restart job with same startBlock
        await this.notifQueue.add({
          type: notificationJobType,
          minBlock: minBlock
        })
      }

      done()
    })

    this.milestoneQueue.process(async (job, done) => {
      console.log('In milestone queue job')
      console.log(job.data.userInfo)
      await this.indexMilestones(job.data.userInfo)
      done()
    })

    let startBlock = await this.getHighestBlockNumber()
    await this.notifQueue.add({
      minBlock: startBlock,
      type: notificationJobType
    })
  }

  async getHighestBlockNumber () {
    let highestBlockNumber = await models.Notification.max('blocknumber')
    if (!highestBlockNumber) {
      highestBlockNumber = this.startBlock
    }

    // TODO: consider whether we really need to cache highest block number like this
    let date = new Date()
    console.log(`Highest block: ${highestBlockNumber} - ${date}`)
    return highestBlockNumber
  }

  async indexMilestones (userInfo) {
    console.log('INDEXMILESTONES')
    console.log(userInfo)
    // TODO: batch requests for each milestone type
    if (userInfo.followersAdded.length > 0) {
      console.log('--START---')
      let queryParams = []
      queryParams['user_id'] = userInfo.followersAdded
      let reqObj = {
        method: 'get',
        url: `${notifDiscProv}/milestones/followers`,
        params: queryParams
      }
      let followerData = await axios(reqObj)
      console.log(followerData)
      console.log('/-----')
    }
  }

  async indexNotifications (minBlock) {
    // TODO: Handle scenario where there are NO notifications returned, how do we still increment the blocknumber
    let reqObj = {
      method: 'get',
      url: `${notifDiscProv}/notifications?min_block_number=${minBlock}`
    }
    // TODO: investigate why this has two .data, after axios switch
    let body = (await axios(reqObj)).data
    let metadata = body.data.info
    let highestReturnedBlockNumber = metadata.max_block_number

    let notifications = body.data.notifications

    // Track users with updates, to calculate milestones
    let notificationStats = {
      followersAdded: [], // List of user IDS who have received a follow
      repostsAdded: {
        track: [],
        albums: [],
        playlists: []
      },
      favoritesAdded: {
        track: [],
        albums: [],
        playlists: []
      },
      maxBlockNumber: highestReturnedBlockNumber
    }

    for (let notif of notifications) {
      // blocknumber + timestamp parsed for all notification types
      let blocknumber = notif.blocknumber
      let timestamp = Date.parse(notif.timestamp.slice(0, -2))

      // Handle the 'follow' notification type
      if (notif.type === notificationTypes.Follow) {
        let notificationTarget = notif.metadata.followee_user_id
        // Skip notification based on user settings
        let userNotifSettings = await models.UserNotificationSettings.findOne(
          { where: { userId: notificationTarget } }
        )
        if (userNotifSettings && !userNotifSettings.followers) {
          continue
        }

        let notificationInitiator = notif.metadata.follower_user_id
        let unreadQuery = await models.Notification.findAll({
          where: {
            isRead: false,
            userId: notificationTarget,
            type: notificationTypes.Follow
          }
        })

        let notificationId = null
        // Insertion into the Notification table
        if (unreadQuery.length === 0) {
          let createNotifTx = await models.Notification.create({
            type: notificationTypes.Follow,
            isRead: false,
            isHidden: false,
            userId: notificationTarget,
            blocknumber: blocknumber,
            timestamp: timestamp
          })
          notificationId = createNotifTx.id
        } else {
          notificationId = unreadQuery[0].id
        }

        if (notificationId) {
          // Insertion into the NotificationActions table
          let notifActionCreateTx = await models.NotificationAction.findOrCreate({
            where: {
              notificationId: notificationId,
              actionEntityType: actionEntityTypes.User,
              actionEntityId: notificationInitiator
            }
          })
          // TODO: Handle log statements to indicate how many notifs have been processed
          let updatePerformed = notifActionCreateTx[1]
          if (updatePerformed) {
            // Update Notification table timestamp
            let newNotificationTimestamp = notifActionCreateTx[0].createdAt
            await models.Notification.update({
              timestamp: newNotificationTimestamp
            }, {
              where: { id: notificationId },
              returning: true,
              plain: true
            })

            notificationStats.followersAdded.push(notificationTarget)
          }
        }
      }

      // Handle the 'repost' notification type
      // track/album/playlist
      if (notif.type === notificationTypes.Repost.base) {
        let repostType = null
        switch (notif.metadata.entity_type) {
          case 'track':
            repostType = notificationTypes.Repost.track
            break
          case 'album':
            repostType = notificationTypes.Repost.album
            break
          case 'playlist':
            repostType = notificationTypes.Repost.playlist
            break
          default:
            throw new Error('Invalid repost type')  // TODO: gracefully handle this in try/catch
        }
        let notificationTarget = notif.metadata.entity_owner_id

        // Skip notification based on user settings
        let userNotifSettings = await models.UserNotificationSettings.findOne(
          { where: { userId: notificationTarget } }
        )
        if (userNotifSettings && !userNotifSettings.reposts) {
          continue
        }

        let notificationEntityId = notif.metadata.entity_id
        let notificationInitiator = notif.initiator

        let unreadQuery = await models.Notification.findAll({
          where: {
            isRead: false,
            isHidden: false,
            userId: notificationTarget,
            type: repostType,
            entityId: notificationEntityId
          }
        })

        let notificationId = null
        // Insert new notification
        if (unreadQuery.length === 0) {
          let repostNotifTx = await models.Notification.create({
            type: repostType,
            isRead: false,
            isHidden: false,
            userId: notificationTarget,
            entityId: notificationEntityId,
            blocknumber,
            timestamp
          })
          notificationId = repostNotifTx.id
        } else {
          notificationId = unreadQuery[0].id
        }

        if (notificationId) {
          let notifActionCreateTx = await models.NotificationAction.findOrCreate({
            where: {
              notificationId: notificationId,
              actionEntityType: actionEntityTypes.User,
              actionEntityId: notificationInitiator
            }
          })
          // Update Notification table timestamp
          let updatePerformed = notifActionCreateTx[1]
          if (updatePerformed) {
            let newNotificationTimestamp = notifActionCreateTx[0].createdAt
            await models.Notification.update({
              timestamp: newNotificationTimestamp
            }, {
              where: { id: notificationId },
              returning: true,
              plain: true
            })
            notificationStats.repostsAdded.add(notificationTarget)
          }
        }
      }

      // Handle the 'favorite' notification type, track/album/playlist
      if (notif.type === notificationTypes.Favorite.base) {
        let favoriteType = null
        switch (notif.metadata.entity_type) {
          case 'track':
            favoriteType = notificationTypes.Favorite.track
            break
          case 'album':
            favoriteType = notificationTypes.Favorite.album
            break
          case 'playlist':
            favoriteType = notificationTypes.Favorite.playlist
            break
          default:
            throw new Error('Invalid favorite type')  // TODO: gracefully handle this in try/catch
        }
        let notificationTarget = notif.metadata.entity_owner_id
        // Skip notification based on user settings
        let userNotifSettings = await models.UserNotificationSettings.findOne(
          { where: { userId: notificationTarget } }
        )
        if (userNotifSettings && !userNotifSettings.favorites) {
          continue
        }

        let notificationEntityId = notif.metadata.entity_id
        let notificationInitiator = notif.initiator
        let unreadQuery = await models.Notification.findAll({
          where: {
            isRead: false,
            isHidden: false,
            userId: notificationTarget,
            type: favoriteType,
            entityId: notificationEntityId
          }
        })

        let notificationId = null
        if (unreadQuery.length === 0) {
          let favoriteNotifTx = await models.Notification.create({
            type: favoriteType,
            isRead: false,
            isHidden: false,
            userId: notificationTarget,
            entityId: notificationEntityId,
            blocknumber,
            timestamp
          })
          notificationId = favoriteNotifTx.id
        } else {
          notificationId = unreadQuery[0].id
        }

        if (notificationId) {
          let notifActionCreateTx = await models.NotificationAction.findOrCreate({
            where: {
              notificationId: notificationId,
              actionEntityType: actionEntityTypes.User,
              actionEntityId: notificationInitiator
            }
          })
          // Update Notification table timestamp
          let updatePerformed = notifActionCreateTx[1]
          if (updatePerformed) {
            let newNotificationTimestamp = notifActionCreateTx[0].createdAt
            await models.Notification.update({
              timestamp: newNotificationTimestamp
            }, {
              where: { id: notificationId },
              returning: true,
              plain: true
            })
          }
        }
      }

      // Handle the 'create' notification type, track/album/playlist
      if (notif.type === notificationTypes.Create.base) {
        let createType = null
        let actionEntityType = null
        switch (notif.metadata.entity_type) {
          case 'track':
            createType = notificationTypes.Create.track
            actionEntityType = actionEntityTypes.Track
            break
          case 'album':
            createType = notificationTypes.Create.album
            actionEntityType = actionEntityTypes.User
            break
          case 'playlist':
            createType = notificationTypes.Create.playlist
            actionEntityType = actionEntityTypes.User
            break
          default:
            throw new Error('Invalid create type')// TODO: gracefully handle this in try/catch
        }

        // Query user IDs from subscriptions table
        // Notifications go to all users subscribing to this track uploader
        let subscribers = await models.Subscription.findAll({
          where: {
            userId: notif.initiator
          }
        })

        // No operation if no users subscribe to this creator
        if (subscribers.length === 0) { continue }

        // The notification entity id is the uploader id for tracks
        // Each track will added to the notification actions table
        // For playlist/albums, the notification entity id is the collection id itself
        let notificationEntityId =
          actionEntityType === actionEntityTypes.Track
            ? notif.initiator
            : notif.metadata.entity_id

        // Action table entity is trackId for CreateTrack notifications
        // Allowing multiple track creates to be associated w/ a single notif for your subscription
        // For collections, the entity is the owner id, producing a distinct notif for each
        let createdActionEntityId =
          actionEntityType === actionEntityTypes.Track
            ? notif.metadata.entity_id
            : notif.metadata.entity_owner_id

        // Create notification for each user
        await Promise.all(subscribers.map(async (s) => {
          // Add notification for this user indicating the uploader has added a track
          let notificationTarget = s.subscriberId

          let unreadQuery = await models.Notification.findAll({
            where: {
              isRead: false,
              isHidden: false,
              userId: notificationTarget,
              type: createType,
              entityId: notificationEntityId
            }
          })

          let notificationId = null
          if (unreadQuery.length === 0) {
            let createTrackNotifTx = await models.Notification.create({
              isRead: false,
              isHidden: false,
              userId: notificationTarget,
              type: createType,
              entityId: notificationEntityId,
              blocknumber,
              timestamp
            })
            notificationId = createTrackNotifTx.id
          } else {
            notificationId = unreadQuery[0].id
          }

          if (notificationId) {
            // Action entity id can be one of album/playlist/track
            let notifActionCreateTx = await models.NotificationAction.findOrCreate({
              where: {
                notificationId,
                actionEntityType: actionEntityType,
                actionEntityId: createdActionEntityId
              }
            })
            // TODO: - How to handle this here?
            /*
            // Update Notification table timestamp
            let updatePerformed = notifActionCreateTx[1]
            if (updatePerformed) {
              let newNotificationTimestamp = notifActionCreateTx[0].createdAt
              await models.Notification.update({
                timestamp: newNotificationTimestamp
              }, {
                where: { id: notificationId },
                returning: true,
                plain: true
              })
            }
            */
          }
        }))

        // Dedupe album /playlist notification
        if (createType === notificationTypes.Create.album ||
            createType === notificationTypes.Create.playlist) {
          let trackIdList = notif.metadata.collection_content.track_ids
          if (trackIdList.length > 0) {
            for (var entry of trackIdList) {
              let trackId = entry.track
              let destroyTx = await models.NotificationAction.destroy({
                where: {
                  actionEntityType: actionEntityTypes.Track,
                  actionEntityId: trackId
                }
              })
            }
          }
        }
      }
    }

    return notificationStats
  }
}

module.exports = NotificationProcessor
