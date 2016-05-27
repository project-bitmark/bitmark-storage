'use strict'
/**
 * OIDC Relying Party API handler module.
 */

var express = require('express')
var debug = require('../debug')
var util = require('../utils')
// const bodyParser = require('body-parser')
var path = require('path')
const addLink = require('../header').addLink

module.exports.api = api
module.exports.authenticate = authenticate
module.exports.resumeUserFlow = resumeUserFlow
module.exports.oidcIssuerHeader = oidcIssuerHeader

/**
 * OIDC Relying Party API middleware.
 * Usage:
 *
 *   ```
 *   app.use('/api/oidc', oidcHandler.api(oidcRpClient))
 *   ```
 * @method api
 * @return {Router} Express router
 */
function api (oidcRpClient) {
  const router = express.Router('/')
  // The /rp (relying party) callback is called at the end of the OIDC signin
  // process
  router.get(['/rp', '/rp/:issuer_id'],
    // Authenticate the RP callback (exchange code for id token)
    authCodeFlowCallback(oidcRpClient),
    // Redirect the user back to returnToUrl (that they were requesting before
    //  being forced to sign in)
    resumeUserFlow
  )
  return router
}

/**
 * Advertises the OIDC Issuer endpoint by returning a Link Relation header
 * of type `oidc.issuer` on an OPTIONS request.
 * Added to avoid an additional request to the serviceCapability document.
 * @param req
 * @param res
 * @param next
 */
function oidcIssuerHeader (req, res, next) {
  let oidcIssuerEndpoint = req.app.locals.oidcConfig.issuer
  addLink(res, oidcIssuerEndpoint, 'oidc.issuer')
  next()
}

/**
 * Authenticates an incoming request. Extracts & verifies access token,
 * creates an OIDC client if necessary, etc.
 * After successful authentication, the `req` object has the following
 * attributes set:
 *   - `req.idToken`  (Raw OIDC ID token in encoded string form)
 *   - `req.refreshToken`  (OIDC Refresh Token in encoded string form)
 *   - `req.oidcClient`  (OIDC client *for this particular request*)
 * If there is no access token (and thus no authentication), all those values
 * above will be null.
 * @param oidcRpClient {OidcRpClient} This server's RP client (contains trusted
 *   client and the client store)
 * @throws {UnauthorizedError} HTTP 400 error on invalid auth headers,
 *   or HTTP 401 Unauthorized error from verifier()
 */
function authenticate (oidcRpClient) {
  const router = express.Router('/')

  router.use('/', express.static(path.join(__dirname, '../static/oidc')))

  // Extract OIDC Issuer from request (if possible), load client for it
  router.use('/', loadAuthClient(oidcRpClient))
  // Authenticate the user using the loaded client
  router.use('/', authWithClient)
  // Record the webId (and OIDC token and claims) in the session
  router.use('/', authSessionInit)

  return router
}

function detectUser (req) {
  var webId
  if (req.accessTokenClaims) {
    webId = req.accessTokenClaims['sub']
  } else if (req.userInfo) {
    webId = req.userInfo.profile
  }
  return webId
}

/**
 * Loads the WebID (that was loaded from the OIDC provider) into the user's
 * session.
 * @method authSessionInit
 */
function authSessionInit (req, res, next) {
  var webId = detectUser(req)
  if (!webId) {
    debug.oidc('authSessionInit: no req.accessTokenClaims or userInfo, skipping session')
    return next()
  }
  debug.oidc('authSessionInit: starting up user session, recording userId')

  req.session.userId = webId
  req.session.identified = true
  debug.oidc('WebId: ' + webId)
  next()
}

/**
 * Authenticates the access token (verifies it, etc), and loads the token,
 * the parsed claims, and the userInfo into the `req` object for downstream
 * use. (See docstring to `authenticate()` for the attributes set.)
 * Requires that `loadAuthClient()` is called before it.
 * @method authWithClient

 */
function authWithClient (req, res, next) {
  debug.oidc('in authWithClient():')
  if (!req.oidcClient) {
    debug.oidc('   * No oidcClient found, next()')
    return next()
  }
  const client = req.oidcClient
  const verifyOptions = {
    allowNoToken: true,
    loadUserInfo: false
  }
  let verifier = client.verifier(verifyOptions)
  // verifier calls next()
  verifier(req, res, next)
}

/**
 * Extracts the OIDC Issuer URL from the token, and loads (or creates) a client
 * for that issuer. Stores it in the `req` object for downstream use.
 * @method loadAuthClient
 * @param oidcRpClient {OidcRpClient} This server's RP client (contains trusted
 *   client and the client store)
 */
function loadAuthClient (oidcRpClient) {
  return (req, res, next) => {
    debug.oidc('loadAuthClient: for req ' + util.fullUrlForReq(req))
    // console.log(req.query)
    var issuer
    try {
      issuer = oidcRpClient.trustedClient.extractIssuer(req)
    } catch (err) {
      debug.oidc('Error during extractIssuer: ' + err)
      return next(err)
    }
    if (!issuer) {
      debug.oidc('Un-authenticated request, no token, next()')
      return next()
    }
    debug.oidc('Extracted issuer: ' + issuer)
    // retrieve it from store
    oidcRpClient.clientForIssuer(issuer)
      .then((client) => {
        debug.oidc('loadAuthClient: Client initialized')
        req.oidcIssuer = issuer
        req.oidcClient = client
        return next()
      })
      .catch((err) => { next(err) })
  }
}

function authCodeFlowCallback (oidcRpClient) {
  return (req, res, next) => {
    debug.oidc('in authCallback():')
    const tokenOptions = {
      code: req.query.code
    }
    var accessToken
    debug.oidc('code: ' + req.query.code + ', exchanging via client.token()')
    // let encodedIssuerId = new Buffer(req.params.issuer_id, 'base64')
    // let issuer = encodedIssuerId.toString('ascii')
    var issuer
    if (req.params.issuer_id) {
      issuer = decodeURIComponent(req.params.issuer_id)
    } else {
      // local / trusted issuer
      issuer = oidcRpClient.trustedClient.client.issuer
    }
    oidcRpClient.clientForIssuer(issuer)
      .then((oidcClient) => {
        debug.oidc('loadAuthClient: Client initialized')
        req.oidcIssuer = issuer
        req.oidcClient = oidcClient
        // Send a request to trade the Auth flow code for an ID Token
        return oidcClient.client.token(tokenOptions)
      })
      .then((tokenResult) => {
        accessToken = tokenResult.access_token
        let idToken = tokenResult.id_token
        let refreshToken = tokenResult.refresh_token
        // debug.oidc(tokenResult)
        let webId = tokenResult.id_claims.sub
        // req.userInfo = { profile: webId }
        req.accessTokenClaims = tokenResult.access_claims
        req.session.accessToken = accessToken
        req.session.idToken = idToken
        req.session.refreshToken = refreshToken
        req.session.issuer = issuer
        req.session.userId = webId
        req.session.identified = true

        // Also store the client in the user's session. Used later by signout()
        req.session.oidcClient = req.oidcClient
        next()
        // return oidcRpClient.trustedClient.client.userInfo({ token: accessToken })
      })
      // .then(function (userInfo) {
      //   req.userInfo = userInfo
      //   next()
      // })
      .catch((err) => {
        debug.oidc(err)
        next(err)
      })
  }
}

/**
 * Redirects the user back to their original requested resource, at the end
 * of the OIDC authentication process.
 * @method resumeUserFlow
 */
function resumeUserFlow (req, res, next) {
  debug.oidc('In resumeUserFlow handler:')

  if (req.session.returnToUrl) {
    let returnToUrl = req.session.returnToUrl
    if (req.session.accessToken) {
      returnToUrl += '?access_token=' + req.session.accessToken
    }
    debug.oidc('  Redirecting to ' + returnToUrl)
    delete req.session.returnToUrl
    return res.redirect(302, returnToUrl)
  }
  res.send('Resume User Flow (failed)')
  // next()
}
