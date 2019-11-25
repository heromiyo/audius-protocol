const { requestNotExcludedFromLogging } = require('./logging')

module.exports.handleResponse = (func) => {
  return async function (req, res, next) {
    try {
      const resp = await func(req, res, next)

      if (!isValidResponse(resp)) {
        throw new Error('Invalid response returned by function')
      }

      sendResponse(req, res, resp)
      next()
    } catch (error) {
      next(error)
    }
  }
}

const sendResponse = module.exports.sendResponse = (req, res, resp) => {
  const elapsedHrTime = req.startHrTime ? process.hrtime(req.startHrTime) : null
  const duration = elapsedHrTime ? elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6 : null

  let logger = req.logger.child({
    statusCode: resp.statusCode,
    ...(duration ? { duration } : {})
  })
  if (resp.statusCode === 200) {
    if (requestNotExcludedFromLogging(req.originalUrl)) {
      logger.info('Success')
    }
  } else {
    logger = logger.child({
      errorMessage: resp.object.error
    })
    logger.info('Error processing request:', resp.object.error)
  }
  res.status(resp.statusCode).send(resp.object)
}

const isValidResponse = module.exports.isValidResponse = (resp) => {
  if (!resp || !resp.statusCode || !resp.object) {
    return false
  }

  return true
}

module.exports.successResponse = (obj = {}) => {
  return {
    statusCode: 200,
    object: obj
  }
}

const errorResponse = module.exports.errorResponse = (statusCode, message) => {
  return {
    statusCode: statusCode,
    object: { error: message }
  }
}

module.exports.errorResponseUnauthorized = (message) => {
  return errorResponse(401, message)
}

module.exports.errorResponseForbidden = (message) => {
  return errorResponse(403, message)
}

module.exports.errorResponseBadRequest = (message) => {
  return errorResponse(400, message)
}

module.exports.errorResponseServerError = (message) => {
  return errorResponse(500, message)
}
