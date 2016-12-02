/**
 * 'Discover Identity Provider' handler.
 * @module provider
 */
module.exports = signin

const validUrl = require('valid-url')
// const request = require('request')
const li = require('li')
const debug = require('../../debug')
// const util = require('../../utils')

function error (status, message) {
  let error = new Error(message)
  error.status = status
  return error
}

function signin () {
  return (req, res, next) => {
    // if (!validUrl.isUri(req.body.webid)) {
    //   return res.status(400).send('This is not a valid URI')
    // }
    let username = req.body.username
    if (!username) {
      return res.status(400).send('Username is required')
    }
    let password = req.body.password
    if (!password) {
      return res.status(400).send('Password is required')
    }

    let ldp = req.app.locals.ldp
    let userStore = req.app.locals.oidc.users
    if (ldp.auth !== 'oidc') {
      res
        .status(500)
        .send('Invalid signin method - oidc not enabled')
      return
    }
    // let baseUrl = util.uriBase(req)
    // Save the previously-requested URL to session
    // (so that the user can be redirected to it after signin)
    let returnToUrl = req.body.returnToUrl
    if (returnToUrl) {
      req.session.returnToUrl = returnToUrl
      debug.oidc('Saving returnToUrl in session as: ' + returnToUrl)
    } else {
      debug.oidc('Not saving returnToUrl to session (not found)!')
    }
    userStore.findUser(username)
      .then(foundUser => {
        if (!foundUser) {
          throw error(400, 'No user found for that username')
        }
        debug.oidc(`User found for username: ${username}`)
        return userStore.matchPassword(foundUser, password)
      })
      .then(validUser => {
        if (!validUser) {
          debug.oidc('User found but no password found')
          throw error(400, 'Invalid password for user')
        }
        // Password matches, proceed
        let webId = validUser.id
        req.session.userId = webId
        req.session.identified = true
        debug.oidc('WebId: ' + webId)
        next()
      })
      .catch(err => {
        if (!err.status) {
          err.status = 500
          err.message = 'Unhandled error in signin api handler: ' + err.message
        }
        res.status(err.status).send(err.message)
      })
  }
}
